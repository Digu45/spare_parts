(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Settings - change these if needed
   * ----------------------------------------------------------------*/
  const CONFIG = {
    invoicePrefix: 'SN',   // invoice numbers look like SN000001
    invoicePad: 6,
    defaultRows: 12        // empty item rows shown on a new bill
  };

  const KEY = {
    bills: 'sn_bills',     // saved bills
    last: 'sn_last_no',    // highest invoice number used so far
    items: 'sn_items',     // part-number -> name/rate/disc suggestions
    draft: 'sn_draft'      // unsaved work in progress (survives refresh)
  };

  /* ------------------------------------------------------------------
   * Helpers
   * ----------------------------------------------------------------*/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  const num = v => {
    const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const fmt = n => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const dmy = iso => (iso ? iso.split('-').reverse().join('/') : '');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ---- Amount in words (Indian system) ---- */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below100 = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));

  function inWords(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    if (crore) parts.push(inWords(crore) + ' Crore');
    if (lakh) parts.push(below100(lakh) + ' Lakh');
    if (thousand) parts.push(below100(thousand) + ' Thousand');
    if (hundred) parts.push(ONES[hundred] + ' Hundred');
    if (rest) parts.push((parts.length ? 'and ' : '') + below100(rest));
    return parts.join(' ');
  }

  /* ------------------------------------------------------------------
   * Elements / state
   * ----------------------------------------------------------------*/
  const sheet = $('#sheet');
  const tbody = $('#itemRows');
  const el = id => document.getElementById(id);

  const FIELDS = ['invNo', 'billDate', 'dueDate', 'orderNo',
    'custName', 'custPhone', 'prevOut', 'crdr', 'remark'];

  let loadedNo = null;     // invoice number of the saved bill currently on screen
  let dirty = false;       // true when there are changes that are not saved
  let prevDate = '';       // used to keep Due Date in step with Date
  let totals = { grand: 0 };

  const rows = () => $$('tr', tbody);

  /* ------------------------------------------------------------------
   * Item rows
   * ----------------------------------------------------------------*/
  const ROW_HTML = `
    <td class="c-sn"><span class="sn"></span><button type="button" class="del no-print" title="Remove this row" tabindex="-1" aria-label="Remove row">&times;</button></td>
    <td><input class="f-part" list="partList" autocomplete="off" aria-label="Part number"></td>
    <td><textarea class="f-name" rows="1" autocomplete="off" aria-label="Item name"></textarea></td>
    <td><input class="f-qty num" inputmode="decimal" autocomplete="off" aria-label="Quantity"></td>
    <td><input class="f-rate num" inputmode="decimal" autocomplete="off" aria-label="Rate"></td>
    <td><input class="f-disc num" inputmode="decimal" autocomplete="off" aria-label="Discount percent"></td>
    <td class="net num"></td>
    <td class="amt num"></td>`;

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function addRow(data = {}, focus = false) {
    const tr = document.createElement('tr');
    tr.innerHTML = ROW_HTML;
    $('.f-part', tr).value = data.part || '';
    $('.f-name', tr).value = data.name || '';
    $('.f-qty', tr).value = data.qty || '';
    $('.f-rate', tr).value = data.rate || '';
    $('.f-disc', tr).value = data.disc || '';
    tbody.appendChild(tr);
    autosize($('.f-name', tr));
    renumber();
    if (focus) $('.f-part', tr).focus();
    return tr;
  }

  function renumber() {
    rows().forEach((tr, i) => { $('.sn', tr).textContent = i + 1; });
  }

  function rowData(tr) {
    return {
      part: $('.f-part', tr).value.trim(),
      name: $('.f-name', tr).value.trim(),
      qty: $('.f-qty', tr).value.trim(),
      rate: $('.f-rate', tr).value.trim(),
      disc: $('.f-disc', tr).value.trim()
    };
  }
  const rowHasData = r => !!(r.part || r.name || r.qty || r.rate);

  /* ------------------------------------------------------------------
   * Calculations
   * ----------------------------------------------------------------*/
  function calc() {
    let sub = 0;
    let amount = 0;

    rows().forEach(tr => {
      const qty = num($('.f-qty', tr).value);
      const rate = num($('.f-rate', tr).value);
      const disc = Math.min(100, Math.max(0, num($('.f-disc', tr).value)));
      const net = round2(rate * (1 - disc / 100));
      const amt = round2(qty * net);
      const show = rate > 0;
      $('.net', tr).textContent = show ? fmt(net) : '';
      $('.amt', tr).textContent = show ? fmt(amt) : '';
      sub += qty * rate;
      amount += amt;
    });

    sub = round2(sub);
    amount = round2(amount);
    const discount = round2(sub - amount);
    const raw = round2(amount + num(el('crdr').value));
    const grand = Math.round(raw);
    const roundoff = round2(grand - raw);
    const totalOut = round2(grand + num(el('prevOut').value));

    el('subTotal').textContent = fmt(sub);
    el('discTotal').textContent = fmt(discount);
    el('roundOff').textContent = fmt(roundoff);
    el('grand').textContent = fmt(grand);
    el('totalOut').textContent = fmt(totalOut);
    el('wordsLine').textContent = grand === 0
      ? ''
      : 'Rs. ' + (grand < 0 ? 'Minus ' : '') + inWords(Math.abs(grand)) + ' only';

    totals = { sub, discount, roundoff, grand, totalOut };
  }

  function syncDates() {
    el('billDateP').textContent = dmy(el('billDate').value);
    el('dueDateP').textContent = dmy(el('dueDate').value);
  }

  /* ------------------------------------------------------------------
   * Read / write the whole bill
   * ----------------------------------------------------------------*/
  function readBill(keepEmptyRows) {
    const bill = {};
    FIELDS.forEach(id => { bill[id] = el(id).value.trim(); });
    let items = rows().map(rowData);
    if (!keepEmptyRows) items = items.filter(rowHasData);
    bill.items = items;
    return bill;
  }

  function writeBill(bill) {
    FIELDS.forEach(id => { el(id).value = bill[id] || ''; });
    tbody.innerHTML = '';
    const items = bill.items || [];
    items.forEach(it => addRow(it));
    for (let i = items.length; i < CONFIG.defaultRows; i++) addRow();
    prevDate = el('billDate').value;
    syncDates();
    calc();
    rows().forEach(tr => autosize($('.f-name', tr)));
  }

  /* ------------------------------------------------------------------
   * Invoice numbers
   * ----------------------------------------------------------------*/
  function nextInvoiceNo() {
    const last = store.get(KEY.last, 0);
    return CONFIG.invoicePrefix + String(last + 1).padStart(CONFIG.invoicePad, '0');
  }

  function bumpCounter(invoiceNo) {
    const m = /(\d+)$/.exec(invoiceNo);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (n > store.get(KEY.last, 0)) store.set(KEY.last, n);
  }

  /* ------------------------------------------------------------------
   * Suggestions (part numbers, customers)
   * ----------------------------------------------------------------*/
  function refreshLists() {
    const partList = el('partList');
    partList.innerHTML = '';
    const catalog = store.get(KEY.items, {});
    Object.keys(catalog).sort().forEach(k => {
      const o = document.createElement('option');
      o.value = catalog[k].part;
      o.label = catalog[k].name || '';
      partList.appendChild(o);
    });

    const custList = el('custList');
    custList.innerHTML = '';
    const seen = new Set();
    store.get(KEY.bills, []).forEach(b => {
      const name = (b.custName || '').trim();
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      const o = document.createElement('option');
      o.value = name;
      custList.appendChild(o);
    });
  }

  function rememberItems(items) {
    const catalog = store.get(KEY.items, {});
    items.forEach(it => {
      if (!it.part || !it.name) return;
      catalog[it.part.toUpperCase()] = { part: it.part, name: it.name, rate: it.rate, disc: it.disc };
    });
    store.set(KEY.items, catalog);
  }

  function fillFromCatalog(tr) {
    const key = $('.f-part', tr).value.trim().toUpperCase();
    if (!key) return;
    const found = store.get(KEY.items, {})[key];
    if (!found) return;
    const setIfEmpty = (sel, value) => {
      const input = $(sel, tr);
      if (!input.value.trim() && value) input.value = value;
    };
    setIfEmpty('.f-name', found.name);
    setIfEmpty('.f-rate', found.rate);
    setIfEmpty('.f-disc', found.disc);
    if (num($('.f-rate', tr).value) > 0) setIfEmpty('.f-qty', '1');
    autosize($('.f-name', tr));
  }

  /* ------------------------------------------------------------------
   * Draft (auto-saved so a refresh does not lose work)
   * ----------------------------------------------------------------*/
  let draftTimer = null;
  function queueDraft() {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      store.set(KEY.draft, { bill: readBill(true), loadedNo });
    }, 400);
  }

  /* ------------------------------------------------------------------
   * Actions
   * ----------------------------------------------------------------*/
  function newBill() {
    clearTimeout(draftTimer);
    store.remove(KEY.draft);
    loadedNo = null;
    writeBill({ invNo: nextInvoiceNo(), billDate: todayISO(), dueDate: todayISO() });
    dirty = false;
  }

  function saveBill() {
    const bill = readBill(false);
    if (!bill.invNo) {
      toast('Please enter an invoice number', 'warn');
      el('invNo').focus();
      return false;
    }
    if (!bill.items.length) {
      toast('Add at least one item before saving', 'warn');
      return false;
    }

    const bills = store.get(KEY.bills, []);
    const idx = bills.findIndex(b => b.invNo === bill.invNo);
    if (idx >= 0 && loadedNo !== bill.invNo &&
        !confirm('Invoice ' + bill.invNo + ' is already saved for another bill.\nReplace it?')) {
      return false;
    }

    bill.total = totals.grand;
    bill.savedAt = Date.now();
    if (idx >= 0) bills[idx] = bill; else bills.push(bill);

    if (!store.set(KEY.bills, bills)) {
      toast('Could not save - browser storage is full or blocked', 'err');
      return false;
    }
    bumpCounter(bill.invNo);
    rememberItems(bill.items);
    refreshLists();
    if (window.SNCloud) SNCloud.saved(bill.invNo);
    // a backup file is downloaded by itself (the Save / Print click allows it)
    const dlNote = SNBackup.autoDownload() ? ' Backup file downloaded.' : '';
    loadedNo = bill.invNo;
    dirty = false;
    clearTimeout(draftTimer);
    store.remove(KEY.draft);
    const cs = window.SNCloud ? SNCloud.status() : { configured: false, state: 'off' };
    const cloudOk = ['synced', 'syncing', 'offline'].includes(cs.state);
    if (cs.configured && cs.state === 'signedout') {
      toast('Bill ' + bill.invNo + ' saved on this computer only. Sign in (cloud button, top right) to back it up online.' + dlNote, 'warn', 9000);
    } else if (cs.configured && cs.state === 'error') {
      toast('Bill ' + bill.invNo + ' saved, but the online backup has a problem. Click the cloud button at the top for details.' + dlNote, 'warn', 9000);
    } else if (cs.state === 'offline') {
      toast('Bill ' + bill.invNo + ' saved. It will back up online when the internet is back.' + dlNote, 'ok', 5000);
    } else if (SNBackup.status().stale && !cloudOk) {
      toast('Bill ' + bill.invNo + ' saved. Reminder: open History and tap "Download backup" to keep your data safe.', 'warn', 6000);
    } else {
      toast('Bill ' + bill.invNo + ' saved.' + dlNote);
    }
    return true;
  }

  function confirmDiscard() {
    return !dirty || confirm('You have unsaved changes on this bill. Discard them?');
  }

  /* ------------------------------------------------------------------
   * History dialog
   * ----------------------------------------------------------------*/
  const dlg = el('histDlg');

  function renderHistory() {
    const q = el('histSearch').value.trim().toLowerCase();
    const bills = store.get(KEY.bills, [])
      .slice()
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .filter(b => !q || [b.invNo, b.custName, b.custPhone].join(' ').toLowerCase().includes(q));

    el('histList').innerHTML = bills.length
      ? bills.map(b => `
        <div class="hist-row">
          <div class="hist-main">
            <b>${esc(b.invNo)}</b> &nbsp; ${esc((b.custName || 'No customer name').toUpperCase())}
            <div class="hist-sub">${esc(dmy(b.billDate))}${b.custPhone ? ' &middot; ' + esc(b.custPhone) : ''} &middot; ${b.items.length} item(s)</div>
          </div>
          <div class="hist-actions">
            <span class="hist-total">&#8377; ${fmt(num(b.total))}</span>
            <button type="button" data-open="${esc(b.invNo)}">Open</button>
            <button type="button" class="danger" data-del="${esc(b.invNo)}">Delete</button>
          </div>
        </div>`).join('')
      : '<p class="empty">' + (q ? 'No bills match your search.' : 'No saved bills yet.') + '</p>';
  }

  function openBill(invNo) {
    const bill = store.get(KEY.bills, []).find(b => b.invNo === invNo);
    if (!bill) return;
    if (!confirmDiscard()) return;
    clearTimeout(draftTimer);
    store.remove(KEY.draft);
    writeBill(bill);
    loadedNo = bill.invNo;
    dirty = false;
    dlg.close();
    window.scrollTo(0, 0);
  }

  function deleteBill(invNo) {
    if (!confirm('Delete bill ' + invNo + '? This cannot be undone.')) return;
    store.set(KEY.bills, store.get(KEY.bills, []).filter(b => b.invNo !== invNo));
    if (window.SNCloud) SNCloud.deleted(invNo);
    if (loadedNo === invNo) loadedNo = null;
    refreshLists();
    renderHistory();
    toast('Bill ' + invNo + ' deleted');
  }

  /* ------------------------------------------------------------------
   * Toast
   * ----------------------------------------------------------------*/
  let toastTimer = null;
  function toast(msg, kind = 'ok', ms = 2600) {
    const t = el('toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
  }

  /* ------------------------------------------------------------------
   * Events
   * ----------------------------------------------------------------*/
  // Any typing -> recalculate
  sheet.addEventListener('input', e => {
    if (e.target.classList.contains('f-name')) autosize(e.target);
    calc();
    queueDraft();
  });

  // Tidy up numbers when leaving a field
  sheet.addEventListener('focusout', e => {
    const t = e.target;
    let changed = false;
    if (t.matches('.f-rate, .f-disc, #prevOut, #crdr') && t.value.trim() !== '') {
      const tidy = fmt(num(t.value));
      if (t.value !== tidy) { t.value = tidy; changed = true; }
    }
    if (t.classList.contains('f-rate')) {
      const qty = $('.f-qty', t.closest('tr'));
      if (num(t.value) > 0 && qty.value.trim() === '') { qty.value = '1'; changed = true; }
    }
    calc();
    if (changed) queueDraft();
  });

  // Part number picked/typed -> fill in name & rate from earlier bills
  tbody.addEventListener('change', e => {
    if (e.target.classList.contains('f-part')) {
      fillFromCatalog(e.target.closest('tr'));
      calc();
      queueDraft();
    }
  });

  // Enter jumps to the same column in the next row (adds a row at the end)
  tbody.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || !e.target.matches('input, textarea')) return;
    e.preventDefault();
    const cls = Array.from(e.target.classList).find(c => c.startsWith('f-'));
    const tr = e.target.closest('tr');
    const next = tr.nextElementSibling || addRow();
    const field = $('.' + cls, next);
    field.focus();
    if (field.select) field.select();
  });

  // Remove a row
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (rows().length <= 1) {
      $$('input, textarea', tr).forEach(i => { i.value = ''; });
      autosize($('.f-name', tr));
    } else {
      tr.remove();
    }
    renumber();
    calc();
    queueDraft();
  });

  // Customer picked -> fill phone from their last bill
  el('custName').addEventListener('change', () => {
    const name = el('custName').value.trim().toLowerCase();
    if (!name || el('custPhone').value.trim()) return;
    const match = store.get(KEY.bills, [])
      .slice()
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .find(b => (b.custName || '').trim().toLowerCase() === name && b.custPhone);
    if (match) { el('custPhone').value = match.custPhone; queueDraft(); }
  });

  // Date changes (keep Due Date following Date unless edited on its own)
  el('billDate').addEventListener('change', () => {
    if (!el('dueDate').value || el('dueDate').value === prevDate) el('dueDate').value = el('billDate').value;
    prevDate = el('billDate').value;
    syncDates();
  });
  el('dueDate').addEventListener('change', syncDates);

  // Toolbar
  el('btnNew').addEventListener('click', () => {
    if (confirmDiscard()) { newBill(); toast('New bill ready'); }
  });
  el('btnAddRow').addEventListener('click', () => addRow({}, true));
  el('btnSave').addEventListener('click', saveBill);
  el('btnPrint').addEventListener('click', () => {
    const hasItems = rows().some(tr => rowHasData(rowData(tr)));
    if (dirty && hasItems) saveBill();
    window.print();
  });
  el('btnHistory').addEventListener('click', () => {
    el('histSearch').value = '';
    renderHistory();
    el('backupInfo').textContent = SNBackup.describe();
    backupMsg('');
    dlg.showModal();
  });

  // Backup / restore (messages show inside the dialog - the page toast sits behind it)
  function backupMsg(text, isErr) {
    const m = el('backupMsg');
    m.textContent = text;
    m.className = 'backup-msg' + (isErr ? ' err' : '');
  }
  el('btnBackup').addEventListener('click', () => {
    const n = SNBackup.export();
    el('backupInfo').textContent = SNBackup.describe();
    backupMsg('Backup downloaded (' + n + (n === 1 ? ' bill' : ' bills') + '). Keep the file somewhere safe, e.g. a pen drive or Google Drive.');
  });
  el('btnRestore').addEventListener('click', () => el('fileRestore').click());
  el('fileRestore').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = await SNBackup.import(file);
      if (window.SNCloud) SNCloud.queueMany(result.changed);
      refreshLists();
      renderHistory();
      el('backupInfo').textContent = SNBackup.describe();
      backupMsg(SNBackup.summary(result));
    } catch (err) {
      backupMsg(err.message, true);
    }
  });

  // History dialog
  el('histClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  el('histSearch').addEventListener('input', renderHistory);
  el('histList').addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    if (open) openBill(open.dataset.open);
    if (del) deleteBill(del.dataset.del);
  });

  // Bills arrived from the cloud (another computer saved something)
  window.addEventListener('sn:data-changed', () => {
    refreshLists();
    if (dlg.open) {
      renderHistory();
      el('backupInfo').textContent = SNBackup.describe();
    }
    // a brand-new empty bill should not reuse a number another computer just used
    if (!dirty && !loadedNo) el('invNo').value = nextInvoiceNo();
  });

  // Ctrl+S saves
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveBill();
    }
  });

  // Closing the tab / leaving with a bill that was typed but not saved -> ask first
  // (the draft is also kept on this computer, but only Save/Print puts it in history, the dashboard and the cloud)
  window.addEventListener('beforeunload', e => {
    if (dirty && rows().some(tr => rowHasData(rowData(tr)))) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Printing: use the invoice number as the PDF file name, re-fit row heights
  let savedTitle = document.title;
  window.addEventListener('beforeprint', () => {
    savedTitle = document.title;
    const no = el('invNo').value.trim();
    if (no) document.title = 'Invoice-' + no;
    syncDates();
    rows().forEach(tr => autosize($('.f-name', tr)));
  });
  window.addEventListener('afterprint', () => { document.title = savedTitle; });

  /* ------------------------------------------------------------------
   * Start
   * ----------------------------------------------------------------*/
  refreshLists();
  const draft = store.get(KEY.draft, null);
  let started = false;

  // Opened from the dashboard: bill.html?open=SN000001
  const openNo = new URLSearchParams(location.search).get('open');
  if (openNo) {
    const bill = store.get(KEY.bills, []).find(b => b.invNo === openNo);
    if (bill && (!draft || confirm('You have an unsaved bill in progress.\nOpen bill ' + openNo + ' and discard it?'))) {
      store.remove(KEY.draft);
      writeBill(bill);
      loadedNo = bill.invNo;
      dirty = false;
      started = true;
    }
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  }

  if (!started) {
    if (draft && draft.bill) {
      writeBill(draft.bill);
      loadedNo = draft.loadedNo || null;
      dirty = true;
    } else {
      newBill();
    }
  }
})();
