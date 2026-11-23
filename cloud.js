/* Cloud sync (Firebase Auth + Firestore) shared by index.html and bill.html.
 *
 * Model
 *  - The browser copy (localStorage) stays the working copy, so the app keeps
 *    working with no internet.
 *  - Every save / delete is put in an outbox (localStorage) and uploaded when
 *    signed in and online. An entry is removed only after the cloud confirms it.
 *  - A live listener brings in changes made on other devices.
 *  - Deleting a bill writes a "deleted" marker instead of removing the document,
 *    so every device learns about it. For the same invoice the newest change wins.
 *
 *  Cloud layout:  shops/{uid}/bills/{b-<invoice no>}  ->  the bill + updatedAt (+ deleted)
 */
(() => {
  'use strict';

  const K = {
    bills: 'sn_bills',
    last: 'sn_last_no',
    items: 'sn_items',
    outbox: 'sn_outbox',
    since: 'sn_cloud_since',
    uid: 'sn_cloud_uid',
    synced: 'sn_cloud_synced_at'
  };
  const FLUSH_TIMEOUT = 20000;
  const RETRY_MS = 60000;
  const SINCE_MARGIN = 60000;      // re-read a minute of overlap to be safe against clock differences

  /* ------------------------------------------------------------------
   * Local storage helpers
   * ----------------------------------------------------------------*/
  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  };
  const asArray = v => (Array.isArray(v) ? v : []);
  const localBills = () => asArray(read(K.bills, []));
  const docId = invNo => 'b-' + encodeURIComponent(invNo);

  /* ------------------------------------------------------------------
   * Adapter: the only code that talks to Firebase.
   * (A different adapter can be supplied through window.SN_CLOUD_ADAPTER.)
   * ----------------------------------------------------------------*/
  function firebaseAdapter() {
    const cfg = window.SN_FIREBASE;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return { missing: 'config' };
    if (typeof firebase === 'undefined') return { missing: 'sdk' };

    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    const auth = firebase.auth(app);
    const db = firebase.firestore(app);
    try { db.settings({ ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true }); } catch (e) { /* already started */ }
    const col = uid => db.collection('shops').doc(uid).collection('bills');

    return {
      onAuth: cb => auth.onAuthStateChanged(u => cb(u ? { uid: u.uid, email: u.email } : null)),
      signIn: (email, password) => auth.signInWithEmailAndPassword(email, password),
      signOut: () => auth.signOut(),
      resetPassword: email => auth.sendPasswordResetEmail(email),
      put: (uid, id, doc) => col(uid).doc(id).set(doc),
      subscribe: (uid, since, onChanges, onError) =>
        col(uid).where('updatedAt', '>', since).onSnapshot(
          snap => onChanges(snap.docChanges().map(c => ({ id: c.doc.id, data: c.doc.data() }))),
          onError)
    };
  }

  const adapter = window.SN_CLOUD_ADAPTER || firebaseAdapter();
  const configured = !!(adapter && adapter.onAuth);

  /* ------------------------------------------------------------------
   * State
   * ----------------------------------------------------------------*/
  let user = null;
  let authKnown = false;
  let authTimedOut = false;
  let flushing = false;
  let lastError = null;
  let unsubscribe = null;
  let listenerError = null;
  let retryTimer = null;
  // Uploads wait until the cloud's current state has been read and merged once, so an
  // older copy on this computer can never overwrite a newer one that is already online.
  let ready = false;
  let readyTimer = null;
  const listeners = new Set();

  const outbox = () => asArray(read(K.outbox, []));

  function status() {
    const pending = outbox().length;
    const base = { configured, user, pending, syncedAt: read(K.synced, null) };
    if (!configured) {
      const why = adapter && adapter.missing === 'sdk' ? 'The Firebase files could not be loaded.' : 'Cloud sync is not set up yet.';
      return Object.assign(base, { state: 'off', label: 'Cloud: not set up', detail: why });
    }
    if (!authKnown) {
      return authTimedOut
        ? Object.assign(base, { state: 'offline', label: 'Cloud: not reachable', detail: 'Cannot reach the cloud sign-in service right now (no internet?). The app keeps working on this computer.' })
        : Object.assign(base, { state: 'syncing', label: 'Cloud: connecting…', detail: '' });
    }
    if (!user) return Object.assign(base, { state: 'signedout', label: 'Sign in to sync', detail: 'Not signed in. Bills are only on this computer until you sign in.' });
    if (lastError && lastError.code === 'permission-denied') {
      return Object.assign(base, { state: 'error', label: 'Sync problem', detail: 'The cloud refused the data. Check the Firestore rules in SETUP-CLOUD.md.' });
    }
    if (lastError || listenerError || (navigator.onLine === false && (pending || !ready))) {
      const n = pending ? ' · ' + pending + ' waiting' : '';
      return Object.assign(base, { state: 'offline', label: 'Offline' + n, detail: 'Cannot reach the cloud right now. Your bills are safe on this computer and will upload automatically.' });
    }
    if (pending || flushing) return Object.assign(base, { state: 'syncing', label: 'Syncing…', detail: pending + ' change(s) waiting to upload.' });
    return Object.assign(base, { state: 'synced', label: 'Synced', detail: 'All bills are saved in the cloud.' });
  }

  function emitStatus() {
    const s = status();
    listeners.forEach(fn => { try { fn(s); } catch (e) { /* ignore */ } });
  }

  const dataChanged = () => window.dispatchEvent(new CustomEvent('sn:data-changed'));

  /* ------------------------------------------------------------------
   * Outbox / upload
   * ----------------------------------------------------------------*/
  function enqueue(invNo, op) {
    if (!configured || !invNo) return;
    const q = outbox().filter(e => e.invNo !== invNo);
    q.push({ invNo, op, ts: Date.now() });
    write(K.outbox, q);
    emitStatus();
    flush();
  }

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))
  ]);

  async function flush() {
    if (!configured || !user || !ready || flushing) return;
    flushing = true;
    emitStatus();
    try {
      for (;;) {
        const entry = outbox()[0];
        if (!entry) break;

        let doc = null;
        if (entry.op === 'put') {
          const bill = localBills().find(b => b.invNo === entry.invNo);
          if (bill) doc = Object.assign({}, bill, { updatedAt: bill.savedAt || entry.ts, deleted: false });
        } else {
          doc = { invNo: entry.invNo, deleted: true, updatedAt: entry.ts };
        }

        if (doc) await withTimeout(adapter.put(user.uid, docId(entry.invNo), doc), FLUSH_TIMEOUT);

        // remove exactly the entry we just sent (it may have been replaced meanwhile)
        const q = outbox();
        const i = q.findIndex(e => e.invNo === entry.invNo && e.ts === entry.ts);
        if (i >= 0) { q.splice(i, 1); write(K.outbox, q); }
        emitStatus();
      }
      lastError = null;
      write(K.synced, Date.now());
    } catch (err) {
      lastError = err;
      scheduleRetry();
    } finally {
      flushing = false;
      emitStatus();
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (outbox().length) flush(); }, RETRY_MS);
  }

  /* ------------------------------------------------------------------
   * Download / merge changes from the cloud
   * ----------------------------------------------------------------*/
  function rememberItems(bill) {
    const catalog = read(K.items, {});
    asArray(bill.items).forEach(it => {
      if (it && it.part && it.name) {
        catalog[String(it.part).toUpperCase()] = { part: String(it.part), name: String(it.name), rate: String(it.rate || ''), disc: String(it.disc || '') };
      }
    });
    write(K.items, catalog);
  }

  function cleanBill(d) {
    const bill = Object.assign({}, d);
    delete bill.updatedAt;
    delete bill.deleted;
    bill.savedAt = d.updatedAt;
    return bill;
  }

  function applyChanges(changes, isFirst, wasFull) {
    const map = new Map(localBills().map(b => [b.invNo, b]));
    const pending = new Map(outbox().map(e => [e.invNo, e]));
    const seen = new Set();
    let since = Number(read(K.since, 0)) || 0;
    let changed = false;
    let outboxChanged = false;
    const toQueue = [];

    changes.forEach(c => {
      const d = c.data;
      if (!d || typeof d.invNo !== 'string' || !d.invNo) return;
      const t = Number(d.updatedAt) || 0;
      seen.add(d.invNo);
      since = Math.max(since, t);

      const local = map.get(d.invNo);
      const entry = pending.get(d.invNo);
      const localTime = entry ? (entry.op === 'put' ? ((local && local.savedAt) || entry.ts) : entry.ts)
        : (local ? (local.savedAt || 0) : -1);

      if (t > localTime) {
        // the cloud copy is newer: it wins, and any waiting upload for it is obsolete
        if (entry) { pending.delete(d.invNo); outboxChanged = true; }
        if (d.deleted) {
          if (map.delete(d.invNo)) changed = true;
        } else if (Array.isArray(d.items)) {
          const bill = cleanBill(d);
          map.set(d.invNo, bill);
          rememberItems(bill);
          changed = true;
        }
      } else if (t < localTime && local && !entry) {
        toQueue.push(d.invNo);          // our copy is newer but was never uploaded
      }
    });

    if (changed) {
      const list = Array.from(map.values());
      write(K.bills, list);
      let last = Number(read(K.last, 0)) || 0;
      list.forEach(b => { const m = /(\d+)$/.exec(b.invNo); if (m) last = Math.max(last, parseInt(m[1], 10)); });
      write(K.last, last);
    }
    if (outboxChanged) write(K.outbox, Array.from(pending.values()));
    write(K.since, since);

    // first sync of this account: upload everything the cloud has never seen
    if (isFirst && wasFull) {
      localBills().forEach(b => { if (!seen.has(b.invNo) && !pending.has(b.invNo)) toQueue.push(b.invNo); });
    }
    toQueue.forEach(no => {
      const q = outbox().filter(e => e.invNo !== no);
      q.push({ invNo: no, op: 'put', ts: Date.now() });
      write(K.outbox, q);
    });

    if (changed) dataChanged();
    if (toQueue.length || outboxChanged) flush();
    emitStatus();
  }

  function startListening() {
    stopListening();
    if (read(K.uid, null) !== user.uid) {
      write(K.uid, user.uid);
      write(K.since, 0);               // a different account: read everything from scratch
    }
    const since = Number(read(K.since, 0)) || 0;
    const wasFull = since === 0;
    let first = true;
    listenerError = null;
    readyTimer = setTimeout(() => {
      if (!ready) { listenerError = Object.assign(new Error('timeout'), { code: 'timeout' }); emitStatus(); }
    }, 15000);

    unsubscribe = adapter.subscribe(
      user.uid,
      Math.max(0, since - SINCE_MARGIN),
      changes => {
        listenerError = null;
        lastError = lastError && lastError.code === 'permission-denied' ? lastError : null;
        applyChanges(changes, first, wasFull);
        first = false;
        write(K.synced, Date.now());
        ready = true;                  // cloud state merged: it is now safe to upload
        clearTimeout(readyTimer);
        flush();
        emitStatus();
      },
      err => {
        listenerError = err;
        if (err && err.code === 'permission-denied') lastError = err;
        emitStatus();
      }
    );
  }

  function stopListening() {
    if (unsubscribe) { try { unsubscribe(); } catch (e) { /* ignore */ } }
    unsubscribe = null;
    ready = false;
    clearTimeout(readyTimer);
  }

  /* ------------------------------------------------------------------
   * Auth
   * ----------------------------------------------------------------*/
  if (configured) {
    adapter.onAuth(u => {
      user = u;
      authKnown = true;
      lastError = null;
      if (u) { startListening(); flush(); }
      else { stopListening(); }
      emitStatus();
    });
    window.addEventListener('online', () => { if (user) flush(); });
    // if the sign-in service does not answer (offline / blocked), say so instead of "connecting" forever
    setTimeout(() => { if (!authKnown) { authTimedOut = true; emitStatus(); } }, 8000);
  }

  const AUTH_MESSAGES = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/invalid-email': 'That email address is not valid.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection.',
    'auth/user-disabled': 'This account has been disabled.'
  };
  const authMessage = err => AUTH_MESSAGES[err && err.code] || ('Could not sign in' + (err && err.message ? ' (' + err.message + ')' : '.'));

  /* ------------------------------------------------------------------
   * Public API
   * ----------------------------------------------------------------*/
  window.SNCloud = {
    configured,
    status,
    onChange(fn) { listeners.add(fn); fn(status()); return () => listeners.delete(fn); },
    saved: invNo => enqueue(invNo, 'put'),
    deleted: invNo => enqueue(invNo, 'del'),
    // upload only these bills (used after a restore) - never "everything", which could overwrite newer cloud copies
    queueMany(invNos) {
      if (!configured) return;
      const nos = new Set(asArray(invNos).filter(Boolean));
      if (!nos.size) return;
      const ts = Date.now();
      const q = outbox().filter(e => !nos.has(e.invNo));
      nos.forEach(invNo => q.push({ invNo, op: 'put', ts }));
      write(K.outbox, q);
      emitStatus();
      flush();
    },
    syncNow() { if (user) { lastError = null; flush(); } },
    signIn: async (email, password) => {
      try { await adapter.signIn(email, password); }
      catch (err) { throw new Error(authMessage(err)); }
    },
    signOut: () => adapter.signOut(),
    resetPassword: async email => {
      try { await adapter.resetPassword(email); }
      catch (err) { throw new Error(authMessage(err)); }
    }
  };

  /* ------------------------------------------------------------------
   * UI: a status pill (in #cloudMount) and a sign-in dialog
   * ----------------------------------------------------------------*/
  const css = document.createElement('style');
  css.textContent = `
    .sn-pill { display:inline-flex; align-items:center; gap:7px; }
    .sn-dot { width:9px; height:9px; border-radius:50%; background:#9ca3af; flex:none; }
    .sn-pill[data-state="synced"] .sn-dot { background:#16a34a; }
    .sn-pill[data-state="syncing"] .sn-dot { background:#2563eb; }
    .sn-pill[data-state="offline"] .sn-dot, .sn-pill[data-state="signedout"] .sn-dot { background:#d97706; }
    .sn-pill[data-state="error"] .sn-dot { background:#dc2626; }
    #snCloudDlg { width:min(420px, calc(100vw - 24px)); padding:18px; border:0; border-radius:12px;
      box-shadow:0 20px 60px rgba(15,23,42,.35); background:var(--surface,#fff); color:var(--ink,#111);
      font:14px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif; }
    #snCloudDlg::backdrop { background:rgba(15,23,42,.45); }
    #snCloudDlg h2 { margin:0 0 4px; font-size:18px; }
    #snCloudDlg p { margin:6px 0; color:var(--ink-2,#444); }
    #snCloudDlg label { display:block; margin-top:10px; font-weight:600; }
    #snCloudDlg input { width:100%; margin-top:4px; padding:9px 10px; font:inherit; color:inherit;
      background:transparent; border:1px solid #9aa3af; border-radius:8px; }
    #snCloudDlg .sn-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
    #snCloudDlg .sn-msg { min-height:18px; font-weight:600; }
    #snCloudDlg .sn-msg.err { color:#dc2626; }
    #snCloudDlg .sn-msg.ok { color:#15803d; }
    #snCloudDlg .sn-link { padding:0; border:0; background:none; color:inherit; text-decoration:underline; cursor:pointer; font:inherit; }
    #snCloudDlg code { padding:1px 5px; border-radius:4px; background:rgba(127,127,127,.18); }
  `;
  document.head.appendChild(css);

  const dlg = document.createElement('dialog');
  dlg.id = 'snCloudDlg';
  dlg.className = 'no-print';
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  const h = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    Object.keys(props || {}).forEach(k => { if (k === 'class') n.className = props[k]; else if (k === 'text') n.textContent = props[k]; else n.setAttribute(k, props[k]); });
    kids.forEach(k => n.append(k));
    return n;
  };

  function renderDialog() {
    const s = status();
    dlg.textContent = '';
    const msg = h('p', { class: 'sn-msg', role: 'status' });
    const close = h('button', { type: 'button', class: 'btn', text: 'Close' });
    close.addEventListener('click', () => dlg.close());

    dlg.append(h('h2', { text: 'Cloud sync' }));

    if (!s.configured) {
      dlg.append(
        h('p', { text: s.detail }),
        h('p', { text: 'Once it is set up, your bills are kept safely online and can be opened from any computer or phone. Follow the steps in SETUP-CLOUD.md, then paste the Firebase settings into firebase-config.js.' }),
        h('div', { class: 'sn-row' }, close));
      return;
    }

    if (!s.user) {
      const email = h('input', { type: 'email', autocomplete: 'username', required: '' });
      const pass = h('input', { type: 'password', autocomplete: 'current-password', required: '' });
      const form = h('form', {},
        h('p', { text: 'Sign in with the shop login to save your bills online.' }),
        h('label', { text: 'Email' }), email,
        h('label', { text: 'Password' }), pass,
        msg);
      const go = h('button', { type: 'submit', class: 'btn primary', text: 'Sign in' });
      const forgot = h('button', { type: 'button', class: 'sn-link', text: 'Forgot password?' });
      form.append(h('div', { class: 'sn-row' }, go, close), h('p', {}, forgot));

      form.addEventListener('submit', async e => {
        e.preventDefault();
        go.disabled = true;
        msg.className = 'sn-msg'; msg.textContent = 'Signing in…';
        try { await SNCloud.signIn(email.value.trim(), pass.value); dlg.close(); }
        catch (err) { msg.className = 'sn-msg err'; msg.textContent = err.message; go.disabled = false; }
      });
      forgot.addEventListener('click', async () => {
        if (!email.value.trim()) { msg.className = 'sn-msg err'; msg.textContent = 'Type your email above first.'; return; }
        try { await SNCloud.resetPassword(email.value.trim()); msg.className = 'sn-msg ok'; msg.textContent = 'Password reset email sent.'; }
        catch (err) { msg.className = 'sn-msg err'; msg.textContent = err.message; }
      });
      dlg.append(form);
      return;
    }

    const when = s.syncedAt ? new Date(s.syncedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet';
    const now = h('button', { type: 'button', class: 'btn', text: 'Sync now' });
    const out = h('button', { type: 'button', class: 'btn', text: 'Sign out' });
    now.addEventListener('click', () => { SNCloud.syncNow(); msg.className = 'sn-msg ok'; msg.textContent = 'Syncing…'; });
    out.addEventListener('click', async () => {
      if (s.pending && !confirm(s.pending + ' change(s) have not been uploaded yet. Sign out anyway?\n(They stay on this computer and upload when you sign in again.)')) return;
      await SNCloud.signOut();
      dlg.close();
    });
    dlg.append(
      h('p', {}, 'Signed in as ', h('b', { text: s.user.email || s.user.uid })),
      h('p', { text: s.label + ' – ' + s.detail }),
      h('p', { text: 'Last synced: ' + when }),
      msg,
      h('div', { class: 'sn-row' }, now, out, close));
  }

  // keep an open dialog in step with the status
  const mount = document.getElementById('cloudMount');
  let pill = null;
  if (mount) {
    pill = h('button', { type: 'button', class: 'btn sn-pill', 'aria-haspopup': 'dialog' },
      h('span', { class: 'sn-dot', 'aria-hidden': 'true' }), h('span', { class: 'sn-label' }));
    pill.addEventListener('click', () => { renderDialog(); dlg.showModal(); });
    mount.appendChild(pill);
  }

  // lets the pages open the sign-in / status window (e.g. from a banner)
  SNCloud.open = () => { renderDialog(); if (!dlg.open) dlg.showModal(); };

  // Cloud sync not set up (empty firebase-config.js): show nothing at all.
  // The button appears by itself once the Firebase settings are filled in.
  const hideWhenUnconfigured = !configured && !!adapter && adapter.missing === 'config';

  SNCloud.onChange(s => {
    if (pill) {
      pill.hidden = hideWhenUnconfigured;
      pill.dataset.state = s.state;
      pill.querySelector('.sn-label').textContent = s.label;
      pill.title = s.detail || s.label;
    }
    // refresh the signed-in view while it is open (never the sign-in form: it would wipe what is being typed)
    if (dlg.open && s.user) renderDialog();
  });
})();
