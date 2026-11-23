/* Backup & restore for the billing app (shared by index.html and bill.html).
 *
 * Bills are stored in this browser only. A backup file is a plain .json copy
 * that can be kept on a pen drive / Google Drive / WhatsApp and restored on any
 * computer or browser.
 */
(() => {
  'use strict';

  const APP = 'shree-narayani-billing';
  const K = {
    bills: 'sn_bills',
    last: 'sn_last_no',
    items: 'sn_items',
    stamp: 'sn_last_backup'
  };
  const STALE_DAYS = 7;

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

  // Ask the browser not to evict our data when disk space is low (best effort)
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) { /* ignore */ }

  function status() {
    const bills = asArray(read(K.bills, []));
    const last = read(K.stamp, null);
    const since = last ? bills.filter(b => (b.savedAt || 0) > last).length : bills.length;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    // Nudge only when there is something unprotected: 3+ bills and never backed up,
    // or new bills and the last backup is a week old.
    const stale = since > 0 && (last == null ? bills.length >= 3 : days >= STALE_DAYS);
    return { total: bills.length, since, last, days, stale };
  }

  function describe() {
    const s = status();
    if (!s.total) return 'No bills saved yet.';
    let text;
    if (s.last) {
      const when = new Date(s.last).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const ago = s.days === 0 ? 'today' : s.days + (s.days === 1 ? ' day ago' : ' days ago');
      text = 'Last backup: ' + when + ' (' + ago + ')';
    } else {
      text = 'No backup downloaded yet';
    }
    text += s.since
      ? ' · ' + s.since + (s.since === 1 ? ' bill' : ' bills') + ' not backed up'
      : ' · everything is backed up';
    return text;
  }

  // Everything that goes into a backup file
  function snapshot() {
    return {
      app: APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      lastNo: read(K.last, 0),
      bills: asArray(read(K.bills, [])),
      items: read(K.items, {})
    };
  }

  const pad2 = n => String(n).padStart(2, '0');

  function exportBackup() {
    const data = snapshot();
    const bills = data.bills;
    const d = new Date();
    // date + time in the name, so files never overwrite or become "name (1).json"
    const stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SN-billing-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    write(K.stamp, Date.now());
    return bills.length;
  }

  /* ------------------------------------------------------------------
   * Automatic download: a backup file is saved to the Downloads folder by itself
   * when a new bill is saved. Browsers only allow a download that comes straight from
   * a click, so this must be called from inside the Save / Print click.
   *   every = after every new bill   daily = first new bill of each day   off = never
   * ----------------------------------------------------------------*/
  const AUTO_KEY = 'sn_auto_dl';
  const MODES = ['every', 'daily', 'off'];
  const autoMode = () => { const v = read(AUTO_KEY, 'every'); return MODES.includes(v) ? v : 'every'; };
  const dayOf = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

  function autoDownload() {
    const mode = autoMode();
    if (mode === 'off') return false;
    if (!asArray(read(K.bills, [])).length) return false;          // never download an empty backup
    if (mode === 'daily') {
      const last = read(K.stamp, null);
      if (last && dayOf(last) === dayOf(Date.now())) return false;  // already backed up today
    }
    try { exportBackup(); return true; } catch (e) { return false; }
  }

  // the setting, wherever the page shows it
  const modeSelect = document.getElementById('autoDlMode');
  if (modeSelect) {
    modeSelect.value = autoMode();
    modeSelect.addEventListener('change', () => { write(AUTO_KEY, modeSelect.value); });
  }

  // Merge a backup file into the bills already here. Nothing is deleted;
  // for the same invoice number the more recently saved copy wins.
  async function importBackup(file) {
    if (!file) throw new Error('No file selected');
    if (file.size > 25 * 1024 * 1024) throw new Error('That file is too large to be a billing backup');

    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { throw new Error('Could not read that file - it is not a valid backup'); }
    if (!data || data.app !== APP || !Array.isArray(data.bills)) {
      throw new Error('This is not a Shree Narayani billing backup file');
    }

    const incoming = data.bills.filter(b =>
      b && typeof b === 'object' && typeof b.invNo === 'string' && b.invNo.trim() && Array.isArray(b.items));
    const invalid = data.bills.length - incoming.length;

    const bills = asArray(read(K.bills, []));
    const index = new Map(bills.map((b, i) => [b.invNo, i]));
    let added = 0, updated = 0, same = 0;
    const changed = [];
    const now = Date.now();
    incoming.forEach(b => {
      const i = index.get(b.invNo);
      // a restored bill counts as saved "now", so it is the newest copy everywhere
      // (including on other computers via cloud sync, even if the bill was deleted since)
      if (i === undefined) {
        bills.push(Object.assign({}, b, { savedAt: now })); index.set(b.invNo, bills.length - 1); added++; changed.push(b.invNo);
      } else if ((b.savedAt || 0) > (bills[i].savedAt || 0)) {
        bills[i] = Object.assign({}, b, { savedAt: now }); updated++; changed.push(b.invNo);
      } else same++;
    });
    if (!write(K.bills, bills)) throw new Error('Could not save - browser storage is full or blocked');

    // never reuse an invoice number that already exists
    let last = Number(read(K.last, 0)) || 0;
    last = Math.max(last, Number(data.lastNo) || 0);
    bills.forEach(b => {
      const m = /(\d+)$/.exec(b.invNo);
      if (m) last = Math.max(last, parseInt(m[1], 10));
    });
    write(K.last, last);

    // part-number suggestions: keep ours, add the ones we did not have
    const catalog = read(K.items, {});
    const theirs = data.items && typeof data.items === 'object' ? data.items : {};
    Object.keys(theirs).forEach(k => {
      const it = theirs[k];
      if (!catalog[k] && it && typeof it.part === 'string' && typeof it.name === 'string') {
        catalog[k] = { part: it.part, name: it.name, rate: String(it.rate || ''), disc: String(it.disc || '') };
      }
    });
    write(K.items, catalog);

    return { added, updated, same, invalid, total: bills.length, changed };
  }

  function summary(r) {
    const parts = [];
    if (r.added) parts.push(r.added + ' added');
    if (r.updated) parts.push(r.updated + ' updated');
    if (r.same) parts.push(r.same + ' already here');
    if (r.invalid) parts.push(r.invalid + ' skipped');
    return 'Restore done: ' + (parts.join(', ') || 'nothing to add') + '. Total bills: ' + r.total + '.';
  }

  window.SNBackup = { status, describe, snapshot, export: exportBackup, autoDownload, autoMode, import: importBackup, summary };
})();
