(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Basics
   * ----------------------------------------------------------------*/
  const BILLS_KEY = 'sn_bills';      // written by bill.html
  const PERIOD_KEY = 'sn_dash_period';
  const RUPEE = '₹';
  const MAX_ROWS = 100;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = id => document.getElementById(id);

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  const num = v => {
    const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const pad2 = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const parseISO = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const dmy = s => (s ? s.split('-').reverse().join('/') : '');
  const shortDate = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const longDate = d => DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  const inr = n => RUPEE + Math.round(n).toLocaleString('en-IN');
  const qtyFmt = n => (Math.round(n * 100) / 100).toLocaleString('en-IN');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // Axis labels: full numbers below 10,000, compact (K / L / Cr) once the axis reaches it
  const trim1 = x => String(Math.round(x * 10) / 10);
  const compactINR = n => {
    if (n >= 1e7) return trim1(n / 1e7) + 'Cr';
    if (n >= 1e5) return trim1(n / 1e5) + 'L';
    if (n >= 1e3) return trim1(n / 1e3) + 'K';
    return String(n);
  };
  const axisFormatter = max => (max < 10000 ? (n => n.toLocaleString('en-IN')) : compactINR);

  /* ------------------------------------------------------------------
   * Data
   * ----------------------------------------------------------------*/
  const WALKIN = 'WALK-IN';

  function normalize(b) {
    const lines = (b.items || []).map(it => {
      const qty = num(it.qty);
      const rate = num(it.rate);
      const disc = Math.min(100, Math.max(0, num(it.disc)));
      return {
        part: (it.part || '').trim(),
        name: (it.name || '').trim(),
        qty,
        gross: qty * rate,
        amt: round2(qty * round2(rate * (1 - disc / 100)))
      };
    }).filter(l => l.part || l.name || l.gross);

    const gross = sum(lines, l => l.gross);
    const net = sum(lines, l => l.amt);
    const hasTotal = b.total !== undefined && b.total !== null && b.total !== '';
    const total = hasTotal ? num(b.total) : Math.round(net + num(b.crdr));

    let date = /^\d{4}-\d{2}-\d{2}$/.test(b.billDate || '') ? b.billDate : '';
    if (!date) date = iso(b.savedAt ? new Date(b.savedAt) : new Date());

    const cust = (b.custName || '').trim();
    return {
      invNo: b.invNo || '',
      date,
      cust: cust ? cust.toUpperCase() : WALKIN,
      named: !!cust,
      phone: (b.custPhone || '').trim(),
      lines,
      gross,
      discount: Math.max(0, round2(gross - net)),
      qty: sum(lines, l => l.qty),
      total,
      outstanding: total + num(b.prevOut)
    };
  }

  /* ---- Sample data (in memory only, never saved) ---- */
  function makeDemoBills() {
    let seed = 20261123;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    const parts = [
      ['1117308K10000', 'HEAD O-RING ACC BS4', 91], ['1222708K00000', 'CRANK OIL SEAL L', 119],
      ['2112033G70000', 'FMD ACC OM/NM/BS6', 540], ['2112533G00000', 'BOSS PIN ACCESS ALL', 300],
      ['2143133G60000', 'RAP PLATE ACC PLAIN', 192], ['2148129L0000', 'MOVABLE DRIVE PLATE', 1804],
      ['2150108K10000', 'CLUTCH ASSY SHOW', 642], ['26024654', 'LUCAS BENDIX ACTIVA', 750],
      ['2760108K10000', 'ENGINE BELT ACCESS NM', 460], ['91211GK8013S', 'OIL SEAL 34/39/3', 45],
      ['ABLDB7', 'GREASE 50GM', 45], ['BS-2201', 'BRAKE SHOE SET', 180],
      ['AF-1180', 'AIR FILTER', 210], ['SP-0045', 'SPARK PLUG', 120],
      ['CC-0310', 'CLUTCH CABLE', 85], ['CK-7700', 'CHAIN SPROCKET KIT', 1450],
      ['EO-1000', 'ENGINE OIL 1L', 520]
    ];
    const customers = [
      ['Patil Motors', '9000000001'], ['Shivaji Garage', '9000000002'], ['Om Auto Works', '9000000003'],
      ['Ganesh Two Wheeler', '9000000004'], ['Jay Bhavani Garage', '9000000005'],
      ['Sai Service Centre', '9000000006'], ['Kolhapur Auto', '9000000007'], ['', '']
    ];
    const dayWeight = [0.35, 0.9, 1, 1, 1.1, 1.25, 1.7];   // Sun..Sat

    const bills = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let n = 0;
    for (let back = 420; back >= 0; back--) {
      const d = new Date(today); d.setDate(d.getDate() - back);
      const count = Math.floor(dayWeight[d.getDay()] * 1.4 + rnd() * 1.6);
      for (let i = 0; i < count; i++) {
        const c = pick(customers);
        const items = [];
        const lineCount = 1 + Math.floor(rnd() * 6);
        for (let k = 0; k < lineCount; k++) {
          const p = pick(parts);
          items.push({ part: p[0], name: p[1], qty: String(1 + Math.floor(rnd() * 3)), rate: String(p[2]), disc: String(pick([0, 10, 10, 20])) });
        }
        const net = sum(items, it => num(it.qty) * num(it.rate) * (1 - num(it.disc) / 100));
        n++;
        bills.push({
          invNo: 'SN' + String(n).padStart(6, '0'), billDate: iso(d),
          custName: c[0], custPhone: c[1], prevOut: rnd() < 0.3 ? String(Math.round(rnd() * 3000)) : '',
          items, total: Math.round(net), savedAt: d.getTime()
        });
      }
    }
    return bills;
  }

  /* ------------------------------------------------------------------
   * State
   * ----------------------------------------------------------------*/
  let demo = false;
  let demoRaw = null;
  let period = store.get(PERIOD_KEY, 'month');
  let tab = 'recent';
  let query = '';

  const PERIODS = ['today', '7d', '30d', 'month', 'year', 'all'];
  if (!PERIODS.includes(period)) period = 'month';

  const loadBills = () => {
    if (demo) { if (!demoRaw) demoRaw = makeDemoBills(); return demoRaw.map(normalize); }
    const raw = store.get(BILLS_KEY, []);
    return (Array.isArray(raw) ? raw : []).map(normalize);
  };

  /* ------------------------------------------------------------------
   * Periods
   * ----------------------------------------------------------------*/
  function getRange(p, all) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = off => { const d = new Date(today); d.setDate(d.getDate() + off); return d; };
    const y = today.getFullYear(), m = today.getMonth(), dd = today.getDate();

    switch (p) {
      case 'today':
        return { p, start: today, end: today, prevStart: day(-1), prevEnd: day(-1), cmp: 'yesterday', text: 'Today, ' + longDate(today) };
      case '7d':
        return { p, start: day(-6), end: today, prevStart: day(-13), prevEnd: day(-7), cmp: 'previous 7 days', text: shortDate(day(-6)) + ' – ' + shortDate(today) + ' ' + y };
      case '30d':
        return { p, start: day(-29), end: today, prevStart: day(-59), prevEnd: day(-30), cmp: 'previous 30 days', text: shortDate(day(-29)) + ' – ' + shortDate(today) + ' ' + y };
      case 'month': {
        const pm = new Date(y, m - 1, 1);
        const pEnd = new Date(pm.getFullYear(), pm.getMonth(), Math.min(dd, daysInMonth(pm.getFullYear(), pm.getMonth())));
        return { p, start: new Date(y, m, 1), end: today, prevStart: pm, prevEnd: pEnd, cmp: 'same days last month', text: MONTHS[m] + ' ' + y + ' (1 – ' + dd + ')' };
      }
      case 'year': {
        const pEnd = new Date(y - 1, m, Math.min(dd, daysInMonth(y - 1, m)));
        return { p, start: new Date(y, 0, 1), end: today, prevStart: new Date(y - 1, 0, 1), prevEnd: pEnd, cmp: 'same period last year', text: 'Year ' + y + ' so far' };
      }
      default: {
        const first = all.length ? parseISO(all.reduce((a, b) => (a < b.date ? a : b.date), all[0].date)) : today;
        return { p: 'all', start: null, end: null, first, cmp: '', text: 'All bills since ' + shortDate(first) + ' ' + first.getFullYear() };
      }
    }
  }

  const within = (bill, s, e) => bill.date >= iso(s) && bill.date <= iso(e);

  /* ------------------------------------------------------------------
   * Aggregations
   * ----------------------------------------------------------------*/
  function summarize(bills) {
    const named = new Set(bills.filter(b => b.named).map(b => b.cust));
    let max = null;
    bills.forEach(b => { if (!max || b.total > max.total) max = b; });
    const gross = sum(bills, b => b.gross);
    const discount = sum(bills, b => b.discount);
    return {
      count: bills.length,
      sales: sum(bills, b => b.total),
      qty: sum(bills, b => b.qty),
      lines: sum(bills, b => b.lines.length),
      gross, discount,
      discPct: gross > 0 ? discount / gross * 100 : 0,
      customers: named.size,
      max
    };
  }

  function groupItems(bills) {
    const map = new Map();
    bills.forEach(b => b.lines.forEach(l => {
      const key = (l.part || l.name).toUpperCase();
      let g = map.get(key);
      if (!g) { g = { key, part: l.part, name: l.name, qty: 0, sales: 0, bills: new Set() }; map.set(key, g); }
      if (l.name) g.name = l.name;
      if (l.part) g.part = l.part;
      g.qty += l.qty;
      g.sales += l.amt;
      g.bills.add(b.invNo);
    }));
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }

  function groupCustomers(bills) {
    const map = new Map();
    const ordered = bills.slice().sort((a, b) => (a.date + a.invNo < b.date + b.invNo ? -1 : 1));
    ordered.forEach(b => {
      let g = map.get(b.cust);
      if (!g) { g = { name: b.cust, phone: '', count: 0, sales: 0, last: '', outstanding: 0 }; map.set(b.cust, g); }
      g.count++;
      g.sales += b.total;
      if (b.phone) g.phone = b.phone;
      g.last = b.date;
      g.outstanding = b.outstanding;
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }

  /* ------------------------------------------------------------------
   * Tooltip
   * ----------------------------------------------------------------*/
  const tip = el('tooltip');

  function showTip(spec, x, y) {
    tip.textContent = '';
    const t = document.createElement('div');
    t.className = 'tt-title';
    t.textContent = spec.title;
    tip.appendChild(t);
    spec.rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'tt-row';
      const key = document.createElement('i');
      key.className = 'tt-key';
      const v = document.createElement('b');
      v.textContent = r.v;
      const k = document.createElement('span');
      k.textContent = r.k;
      row.append(key, v, k);
      tip.appendChild(row);
    });
    tip.hidden = false;
    moveTip(x, y);
  }
  function moveTip(x, y) {
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.transform = 'translate(' + Math.max(8, left) + 'px,' + Math.max(8, top) + 'px)';
  }
  const hideTip = () => { tip.hidden = true; };

  function bindTip(node, spec) {
    node.addEventListener('pointerenter', e => showTip(spec, e.clientX, e.clientY));
    node.addEventListener('pointermove', e => moveTip(e.clientX, e.clientY));
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', () => {
      const r = node.getBoundingClientRect();
      showTip(spec, r.left + r.width / 2, r.top);
    });
    node.addEventListener('blur', hideTip);
  }

  /* ------------------------------------------------------------------
   * Table helper (also the "table view" of every chart)
   * ----------------------------------------------------------------*/
  // cols: [{h, r}]   rows: [[cell,...]]  where a cell is a string or {href, text}
  function buildTable(caption, cols, rows) {
    const table = document.createElement('table');
    table.className = 't';
    const cap = document.createElement('caption');
    cap.className = 'sr-only';
    cap.textContent = caption;
    table.appendChild(cap);

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    cols.forEach(c => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c.h;
      if (c.r) th.className = 'r';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      row.forEach((cell, i) => {
        const td = document.createElement('td');
        const cls = [];
        if (cols[i].r) cls.push('r');
        if (cols[i].nm) cls.push('nm');
        td.className = cls.join(' ');
        if (cell && typeof cell === 'object') {
          const a = document.createElement('a');
          a.className = 'link';
          a.href = cell.href;
          a.textContent = cell.text;
          td.appendChild(a);
        } else {
          td.textContent = cell;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function setTable(hostId, caption, cols, rows) {
    const host = el(hostId);
    host.textContent = '';
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'nodata';
      p.textContent = 'Nothing to show for this period.';
      host.appendChild(p);
    } else {
      host.appendChild(buildTable(caption, cols, rows));
    }
  }

  const noData = (host, text) => {
    host.textContent = '';
    const p = document.createElement('p');
    p.className = 'nodata';
    p.textContent = text;
    host.appendChild(p);
  };

  /* ------------------------------------------------------------------
   * Column chart (SVG) - used for the trend and the weekday charts
   * ----------------------------------------------------------------*/
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs, text) {
    const n = document.createElementNS(SVGNS, name);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    if (text != null) n.textContent = text;
    return n;
  }

  function niceScale(v) {
    if (v <= 0) return { max: 1, ticks: [0, 1] };
    const raw = v / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    const n = Math.ceil(v / step - 1e-9);
    return { max: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
  }

  // data: [{label, value, future?, hl?, tip:{title, rows}}]
  function columnChart(host, data, o) {
    host.textContent = '';
    const W = Math.max(260, Math.floor(host.clientWidth) || 600);
    const H = o.height || 250;
    const m = { t: 24, r: 8, b: 28, l: 46 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxV = Math.max(0, ...data.map(d => d.value));
    const sc = niceScale(maxV);
    const fmtAxis = axisFormatter(sc.max);

    const svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.label });
    const yOf = v => m.t + ih - (v / sc.max) * ih;

    sc.ticks.forEach(t => {
      const y = Math.round(yOf(t)) + 0.5;
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: t === 0 ? 'axis-line' : 'grid-line' }));
      svg.appendChild(svgEl('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'tick' }, fmtAxis(t)));
    });

    const n = data.length;
    const slot = iw / n;
    const bw = Math.max(2, Math.min(24, slot - 2));
    const every = Math.max(1, Math.ceil((o.labelW || 40) / slot));
    const peak = maxV > 0 ? data.findIndex(d => d.value === maxV) : -1;

    data.forEach((d, i) => {
      const x0 = m.l + i * slot;
      const g = svgEl('g', { class: 'mk' });

      if (!d.future) {
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'img');
        g.setAttribute('aria-label', d.tip.title + ': ' + d.tip.rows.map(r => r.v + ' ' + r.k).join(', '));
      }

      g.appendChild(svgEl('rect', { class: 'focus-ring', x: x0 + 0.5, y: m.t, width: Math.max(0, slot - 1), height: ih, rx: 3 }));
      if (d.value > 0 && !d.future) {
        const h = Math.max(1, (d.value / sc.max) * ih);
        const bx = x0 + (slot - bw) / 2;
        const y = m.t + ih - h;
        const r = Math.min(4, bw / 2, h);
        const path = 'M' + bx + ',' + (y + h) + ' L' + bx + ',' + (y + r) +
          ' Q' + bx + ',' + y + ' ' + (bx + r) + ',' + y +
          ' L' + (bx + bw - r) + ',' + y +
          ' Q' + (bx + bw) + ',' + y + ' ' + (bx + bw) + ',' + (y + r) +
          ' L' + (bx + bw) + ',' + (y + h) + ' Z';
        g.appendChild(svgEl('path', { d: path, class: 'bar' + (o.emphasis && !d.hl ? ' dim' : '') }));
      }
      // hit area: the whole slot, taller than the mark
      g.appendChild(svgEl('rect', { class: 'hit', x: x0, y: m.t - 6, width: slot, height: ih + 6 }));
      if (!d.future) bindTip(g, d.tip);
      svg.appendChild(g);

      if (i % every === 0) {
        svg.appendChild(svgEl('text', { x: x0 + slot / 2, y: H - 9, 'text-anchor': 'middle', class: 'tick' }, d.label));
      }
    });

    // one direct label: the peak
    if (peak >= 0) {
      const d = data[peak];
      const cx = Math.min(W - m.r - 22, Math.max(m.l + 22, m.l + peak * slot + slot / 2));
      const y = Math.max(12, yOf(d.value) - 7);
      svg.appendChild(svgEl('text', { x: cx, y, 'text-anchor': 'middle', class: 'peak' }, inr(d.value)));
    }

    host.appendChild(svg);
  }

  /* Re-draw column charts when their width changes */
  const redraw = new Map();
  const lastWidth = new Map();
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => {
      entries.forEach(en => {
        const w = Math.floor(en.contentRect.width);
        const fn = redraw.get(en.target);
        if (!fn || w <= 0 || Math.abs(w - (lastWidth.get(en.target) || 0)) < 2) return;
        lastWidth.set(en.target, w);
        fn();
      });
    })
    : null;

  function drawColumns(host, data, o) {
    const fn = () => columnChart(host, data, o);
    lastWidth.set(host, Math.floor(host.clientWidth));
    if (!data.some(d => d.value > 0)) { redraw.delete(host); noData(host, o.empty); return; }
    redraw.set(host, fn);
    fn();
    if (ro) ro.observe(host);
  }

  /* ------------------------------------------------------------------
   * Ranked horizontal bars (HTML) - top items / customers
   * ----------------------------------------------------------------*/
  // items: [{name, value, tip}]
  function rankedBars(host, items, emptyText) {
    host.textContent = '';
    if (!items.length) { noData(host, emptyText); return; }
    const max = Math.max(...items.map(i => i.value));
    const ul = document.createElement('ul');
    ul.className = 'rank';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'rk';
      li.tabIndex = 0;
      li.setAttribute('aria-label', it.tip.title + ': ' + it.tip.rows.map(r => r.v + ' ' + r.k).join(', '));

      const name = document.createElement('div');
      name.className = 'rk-name';
      const nn = document.createElement('span');
      nn.className = 'n';
      nn.textContent = i + 1;
      const tt = document.createElement('span');
      tt.className = 't';
      tt.textContent = it.name;
      name.append(nn, tt);

      const bar = document.createElement('div');
      bar.className = 'rk-bar';
      const fill = document.createElement('span');
      fill.className = 'rk-fill';
      fill.style.width = (it.value > 0 ? Math.max(1, it.value / max * 68) : 0) + '%';
      const val = document.createElement('span');
      val.className = 'rk-val';
      val.textContent = inr(it.value);
      bar.append(fill, val);

      li.append(name, bar);
      bindTip(li, it.tip);
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  /* ------------------------------------------------------------------
   * Sections
   * ----------------------------------------------------------------*/
  function setDelta(id, cur, prev, cmp) {
    const d = el(id);
    d.className = 'delta';
    d.textContent = '';
    if (prev === null || !cmp) return;
    const vs = document.createElement('span');
    vs.className = 'vs';
    vs.textContent = ' vs ' + cmp;
    if (prev === 0 && cur === 0) {
      d.textContent = 'No change';
    } else if (prev === 0) {
      d.classList.add('up');
      d.textContent = '▲ New';
    } else {
      const pct = (cur - prev) / prev * 100;
      const abs = Math.abs(pct);
      if (abs < 0.05) {
        d.textContent = '▬ 0%';
      } else {
        d.classList.add(pct > 0 ? 'up' : 'down');
        d.textContent = (pct > 0 ? '▲ ' : '▼ ') + (abs >= 10 ? Math.round(abs) : abs.toFixed(1)) + '%';
      }
    }
    d.appendChild(vs);
  }

  function renderKpis(cur, prev, range) {
    const s = summarize(cur);
    const ps = prev ? summarize(prev) : null;
    const avg = s.count ? s.sales / s.count : 0;
    const pAvg = ps ? (ps.count ? ps.sales / ps.count : 0) : null;

    el('kSales').textContent = inr(s.sales);
    setDelta('dSales', s.sales, ps ? ps.sales : null, range.cmp);
    el('kBills').textContent = s.count.toLocaleString('en-IN');
    setDelta('dBills', s.count, ps ? ps.count : null, range.cmp);
    el('kAvg').textContent = inr(avg);
    setDelta('dAvg', avg, pAvg, range.cmp);

    el('kItems').textContent = qtyFmt(s.qty);
    el('sItems').textContent = s.count ? plural(s.lines, 'line', 'lines') + ' on bills' : '';
    el('kDisc').textContent = inr(s.discount);
    el('sDisc').textContent = s.gross > 0 ? Math.round(s.discPct * 10) / 10 + '% off list price' : '';
    el('kCust').textContent = s.customers.toLocaleString('en-IN');
    el('sCust').textContent = s.count ? 'named customers' : '';
    el('kMax').textContent = inr(s.max ? s.max.total : 0);
    el('sMax').textContent = s.max ? s.max.invNo + ' · ' + (s.max.named ? s.max.cust : 'Walk-in') : '';
    return s;
  }

  function addInsight(list, strong, text) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = strong;
    li.append(b, document.createTextNode(text));
    list.appendChild(li);
  }

  function renderInsights(cur, prev, range, s, items, custs, wd) {
    const ul = el('insights');
    ul.textContent = '';
    if (!cur.length) {
      addInsight(ul, 'No bills in this period. ', 'Press Make Bill to create one, or pick a longer period above.');
      return;
    }

    // 1. sales + comparison
    let line = ' from ' + plural(s.count, 'bill', 'bills');
    if (prev && range.cmp) {
      const ps = summarize(prev);
      if (ps.sales > 0) {
        const pct = (s.sales - ps.sales) / ps.sales * 100;
        line += pct >= 0 ? ', up ' : ', down ';
        line += (Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)) + '% vs ' + range.cmp + ' (' + inr(ps.sales) + ')';
      } else {
        line += ', with nothing to compare against (no sales ' + (range.p === 'today' ? 'yesterday' : 'in the ' + range.cmp) + ')';
      }
    }
    addInsight(ul, inr(s.sales), line + '.');

    // 2. best day
    const byDay = new Map();
    cur.forEach(b => {
      const g = byDay.get(b.date) || { sales: 0, n: 0 };
      g.sales += b.total; g.n++;
      byDay.set(b.date, g);
    });
    if (byDay.size > 1) {
      let best = null;
      byDay.forEach((g, d) => { if (!best || g.sales > best.g.sales) best = { d, g }; });
      addInsight(ul, 'Best day: ' + longDate(parseISO(best.d)), ' – ' + inr(best.g.sales) + ' from ' + plural(best.g.n, 'bill', 'bills') + '.');
    }

    // 3. top item
    if (items.length) {
      const t = items[0];
      addInsight(ul, 'Top item: ' + t.name, ' brought in ' + inr(t.sales) + ' (' + qtyFmt(t.qty) + ' sold).');
    }

    // 4. top customer
    const named = custs.filter(c => c.name !== WALKIN);
    if (named.length) {
      const share = s.sales > 0 ? Math.round(named[0].sales / s.sales * 100) : 0;
      addInsight(ul, 'Top customer: ' + named[0].name, ' bought ' + inr(named[0].sales) + ' (' + share + '% of sales).');
    }

    // 5. discounts
    if (s.gross > 0) {
      addInsight(ul, 'Discounts: ' + inr(s.discount), ', which is ' + Math.round(s.discPct * 10) / 10 + '% off the list price on average.');
    }

    // 6. repeat customers
    if (named.length >= 2) {
      const repeat = named.filter(c => c.count > 1).length;
      addInsight(ul, 'Repeat customers: ' + repeat + ' of ' + named.length, ' bought more than once.');
    }

    // 7. busiest weekday (only meaningful over a few weeks)
    if (byDay.size >= 14) {
      let bi = 0;
      wd.forEach((t, i) => { if (t.sales > wd[bi].sales) bi = i; });
      addInsight(ul, 'Busiest day of the week: ' + DAYS_LONG[bi], ' – ' + inr(wd[bi].sales) + ' in sales.');
    }
  }

  /* ---- Sales trend ---- */
  function buildTrendBuckets(range, all) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const buckets = [];
    const dayBuckets = (start, count) => {
      for (let i = 0; i < count; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        buckets.push({ key: iso(d), date: d, label: count <= 8 ? DAYS[d.getDay()] + ' ' + d.getDate() : d.getDate() + ' ' + MONTHS[d.getMonth()], title: longDate(d), future: d > today, month: false });
      }
    };
    const monthBuckets = (startY, startM, count) => {
      for (let i = 0; i < count; i++) {
        const d = new Date(startY, startM + i, 1);
        buckets.push({
          key: d.getFullYear() + '-' + pad2(d.getMonth() + 1), date: d,
          label: MONTHS[d.getMonth()] + (count > 12 || d.getMonth() === 0 ? " '" + String(d.getFullYear()).slice(2) : ''),
          title: MONTHS[d.getMonth()] + ' ' + d.getFullYear(),
          future: d > today, month: true
        });
      }
    };

    let sub;
    if (range.p === 'today') {
      const s = new Date(today); s.setDate(s.getDate() - 6);
      dayBuckets(s, 7); sub = 'Daily sales · last 7 days';
    } else if (range.p === '7d') {
      dayBuckets(range.start, 7); sub = 'Daily sales · last 7 days';
    } else if (range.p === '30d') {
      dayBuckets(range.start, 30); sub = 'Daily sales · last 30 days';
    } else if (range.p === 'month') {
      const y = today.getFullYear(), m = today.getMonth();
      dayBuckets(new Date(y, m, 1), daysInMonth(y, m)); sub = 'Daily sales · ' + MONTHS[m] + ' ' + y;
    } else if (range.p === 'year') {
      monthBuckets(today.getFullYear(), 0, 12); sub = 'Monthly sales · ' + today.getFullYear();
    } else {
      const first = range.first;
      let count = (today.getFullYear() - first.getFullYear()) * 12 + today.getMonth() - first.getMonth() + 1;
      count = Math.min(24, Math.max(6, count));
      const start = new Date(today.getFullYear(), today.getMonth() - (count - 1), 1);
      monthBuckets(start.getFullYear(), start.getMonth(), count);
      sub = 'Monthly sales · last ' + count + ' months';
    }

    const map = new Map(buckets.map(b => [b.key, { sales: 0, n: 0 }]));
    all.forEach(b => {
      const k = buckets[0].month ? b.date.slice(0, 7) : b.date;
      const g = map.get(k);
      if (g) { g.sales += b.total; g.n++; }
    });
    return {
      sub,
      data: buckets.map(b => {
        const g = map.get(b.key);
        return {
          label: b.label, value: g.sales, future: b.future, n: g.n, title: b.title,
          tip: { title: b.title, rows: [{ v: inr(g.sales), k: 'sales' }, { v: String(g.n), k: g.n === 1 ? 'bill' : 'bills' }] }
        };
      })
    };
  }

  function renderTrend(range, all) {
    const t = buildTrendBuckets(range, all);
    el('trendSub').textContent = t.sub;
    const monthly = t.sub.startsWith('Monthly');
    drawColumns(el('trendChart'), t.data, {
      label: t.sub, height: 260, labelW: monthly ? 50 : 46,
      empty: 'No sales in this period yet.'
    });
    setTable('trendTable', t.sub,
      [{ h: monthly ? 'Month' : 'Date' }, { h: 'Bills', r: true }, { h: 'Sales', r: true }],
      t.data.filter(d => !d.future).map(d => [d.title, String(d.n), inr(d.value)]));
  }

  /* ---- Top items / customers ---- */
  function renderItems(items) {
    const top = items.slice(0, 6);
    rankedBars(el('itemsChart'), top.map(i => ({
      name: i.name || i.part, value: i.sales,
      tip: { title: (i.name || i.part) + (i.part && i.name ? ' (' + i.part + ')' : ''), rows: [{ v: inr(i.sales), k: 'sales' }, { v: qtyFmt(i.qty), k: 'sold' }, { v: String(i.bills.size), k: i.bills.size === 1 ? 'bill' : 'bills' }] }
    })), 'No items sold in this period.');
    setTable('itemsTable', 'Top items',
      [{ h: 'Item', nm: true }, { h: 'Sold', r: true }, { h: 'Sales', r: true }],
      top.map(i => [i.name || i.part, qtyFmt(i.qty), inr(i.sales)]));
  }

  function renderCustomers(custs) {
    const top = custs.filter(c => c.name !== WALKIN).slice(0, 6);
    rankedBars(el('custChart'), top.map(c => ({
      name: c.name, value: c.sales,
      tip: { title: c.name, rows: [{ v: inr(c.sales), k: 'sales' }, { v: String(c.count), k: c.count === 1 ? 'bill' : 'bills' }, { v: inr(c.sales / c.count), k: 'average bill' }] }
    })), 'No named customers in this period.');
    setTable('custTable', 'Top customers',
      [{ h: 'Customer', nm: true }, { h: 'Bills', r: true }, { h: 'Sales', r: true }],
      top.map(c => [c.name, String(c.count), inr(c.sales)]));
  }

  /* ---- Weekday ---- */
  function weekdayTotals(cur) {
    const t = Array.from({ length: 7 }, () => ({ sales: 0, n: 0 }));
    cur.forEach(b => { const g = t[parseISO(b.date).getDay()]; g.sales += b.total; g.n++; });
    return t;
  }

  function renderWeekday(totals) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const maxV = Math.max(...totals.map(t => t.sales));
    const data = order.map(i => ({
      label: DAYS[i], value: totals[i].sales, hl: maxV > 0 && totals[i].sales === maxV,
      tip: { title: DAYS_LONG[i], rows: [{ v: inr(totals[i].sales), k: 'sales' }, { v: String(totals[i].n), k: totals[i].n === 1 ? 'bill' : 'bills' }] }
    }));
    el('wdSub').textContent = maxV > 0 ? 'Sales by day of the week · busiest highlighted' : 'Sales by day of the week';
    drawColumns(el('wdChart'), data, { label: 'Sales by day of the week', height: 310, labelW: 30, emphasis: true, empty: 'No sales in this period.' });
    setTable('wdTable', 'Sales by day of the week',
      [{ h: 'Day' }, { h: 'Bills', r: true }, { h: 'Sales', r: true }],
      data.map((d, i) => [DAYS_LONG[order[i]], String(totals[order[i]].n), inr(d.value)]));
  }

  /* ---- Details tabs ---- */
  function renderDetails(cur, items, custs) {
    const host = el('detTable');
    host.textContent = '';
    const q = query.trim().toLowerCase();
    let cols, rows, caption;

    if (tab === 'recent') {
      caption = 'Recent bills';
      cols = [{ h: 'Invoice' }, { h: 'Date' }, { h: 'Customer', nm: true }, { h: 'Phone' }, { h: 'Items', r: true }, { h: 'Total', r: true }, { h: '' }];
      rows = cur.slice()
        .sort((a, b) => (a.date + a.invNo < b.date + b.invNo ? 1 : -1))
        .map(b => ({
          hay: [b.invNo, b.cust, b.phone].concat(b.lines.map(l => l.name + ' ' + l.part)).join(' ').toLowerCase(),
          cells: [b.invNo, dmy(b.date), b.named ? b.cust : 'Walk-in', b.phone || '-', String(b.lines.length), inr(b.total),
            demo ? '' : { href: 'bill.html?open=' + encodeURIComponent(b.invNo), text: 'Open' }]
        }));
    } else if (tab === 'customers') {
      caption = 'Customers';
      cols = [{ h: 'Customer', nm: true }, { h: 'Phone' }, { h: 'Bills', r: true }, { h: 'Sales', r: true }, { h: 'Average bill', r: true }, { h: 'Last bill' }, { h: 'Outstanding on last bill', r: true }];
      rows = custs.map(c => ({
        hay: (c.name + ' ' + c.phone).toLowerCase(),
        cells: [c.name === WALKIN ? 'Walk-in' : c.name, c.phone || '-', String(c.count), inr(c.sales), inr(c.sales / c.count), dmy(c.last), c.name === WALKIN ? '-' : inr(c.outstanding)]
      }));
    } else {
      caption = 'Items';
      cols = [{ h: 'Part no' }, { h: 'Item', nm: true }, { h: 'Sold', r: true }, { h: 'Sales', r: true }, { h: 'Bills', r: true }];
      rows = items.map(i => ({
        hay: (i.part + ' ' + i.name).toLowerCase(),
        cells: [i.part || '-', i.name || '-', qtyFmt(i.qty), inr(i.sales), String(i.bills.size)]
      }));
    }

    if (q) rows = rows.filter(r => r.hay.includes(q));
    el('detSub').textContent = rows.length + (rows.length === 1 ? ' record' : ' records') + (q ? ' matching your search' : ' in this period');

    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'nodata';
      p.textContent = q ? 'Nothing matches your search.' : 'Nothing to show for this period.';
      host.appendChild(p);
      return;
    }
    host.appendChild(buildTable(caption, cols, rows.slice(0, MAX_ROWS).map(r => r.cells)));
    if (rows.length > MAX_ROWS) {
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = 'Showing the first ' + MAX_ROWS + ' of ' + rows.length + '. Use the search box or a shorter period to narrow it down.';
      host.appendChild(n);
    }
  }

  /* ------------------------------------------------------------------
   * Render everything
   * ----------------------------------------------------------------*/
  let view = null;   // cached slices so the details tab / search can re-render quickly

  /* ---- Backup & restore ---- */
  function renderBackup() {
    const s = SNBackup.status();
    el('backupInfo').textContent = SNBackup.describe();
    el('btnBackup').disabled = s.total === 0;

    const cs = window.SNCloud ? SNCloud.status() : { configured: false, state: 'off' };
    const cloudOk = ['synced', 'syncing'].includes(cs.state);

    // Online backup configured but not working -> this is the one message that matters
    const cloudProblem = !demo && cs.configured && (cs.state === 'signedout' || cs.state === 'error');
    el('cloudBanner').hidden = !cloudProblem;
    if (cloudProblem) {
      el('cloudBannerText').textContent = cs.state === 'signedout'
        ? 'Automatic online backup is OFF. Sign in so every new bill is saved online and can never be lost with the browser.'
        : 'Online backup problem: ' + cs.detail;
      el('cloudBannerBtn').textContent = cs.state === 'signedout' ? 'Sign in' : 'Details';
    }

    // With online backup working, a downloaded backup file is only an extra copy - no nagging.
    const show = !demo && s.stale && !cloudOk && !cloudProblem;
    el('backupBanner').hidden = !show;
    if (show) {
      const t = el('backupBannerText');
      t.textContent = '';
      const b = document.createElement('b');
      b.textContent = 'Back up your bills. ';
      const unsaved = s.since + (s.since === 1 ? ' bill is' : ' bills are') + ' not backed up';
      t.append(b, document.createTextNode(
        (s.last ? 'Your last backup was ' + s.days + ' days ago and ' + unsaved + '. ' : unsaved + ' yet. ') +
        'Bills are stored in this browser only and are lost if its data is cleared. Download a backup now.'));
    }
  }

  function backupMsg(text, isErr) {
    const m = el('backupMsg');
    m.textContent = text;
    m.className = 'bk-msg' + (isErr ? ' err' : '');
  }

  function doBackup() {
    const n = SNBackup.export();
    renderBackup();
    backupMsg('Backup downloaded (' + n + (n === 1 ? ' bill' : ' bills') + '). Keep the file somewhere safe, e.g. a pen drive or Google Drive.');
  }

  function render() {
    const all = loadBills();
    const empty = !all.length && !demo;
    el('emptyState').hidden = !empty;
    el('content').hidden = empty;
    el('demoBanner').hidden = !demo;
    el('btnDemoLink').hidden = demo;
    $$('#periodSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    renderBackup();
    if (empty) { el('rangeText').textContent = ''; return; }

    const range = getRange(period, all);
    el('rangeText').textContent = range.text;

    const cur = range.start ? all.filter(b => within(b, range.start, range.end)) : all;
    const prev = range.prevStart ? all.filter(b => within(b, range.prevStart, range.prevEnd)) : null;

    const s = renderKpis(cur, prev, range);
    const items = groupItems(cur);
    const custs = groupCustomers(cur);
    const wd = weekdayTotals(cur);

    renderInsights(cur, prev, range, s, items, custs, wd);
    renderTrend(range, all);
    renderItems(items);
    renderCustomers(custs);
    renderWeekday(wd);

    view = { cur, items, custs };
    renderDetails(cur, items, custs);
  }

  /* ------------------------------------------------------------------
   * Events
   * ----------------------------------------------------------------*/
  el('periodSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-period]');
    if (!b) return;
    period = b.dataset.period;
    store.set(PERIOD_KEY, period);
    render();
  });

  el('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b || !view) return;
    tab = b.dataset.tab;
    $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
    renderDetails(view.cur, view.items, view.custs);
  });

  el('q').addEventListener('input', e => {
    query = e.target.value;
    if (view) renderDetails(view.cur, view.items, view.custs);
  });

  // Chart <-> table toggle on every chart card
  $$('[data-card]').forEach(card => {
    const btn = $('.toggle', card);
    const chart = $('.chart-host', card);
    const table = $('.table-host', card);
    btn.addEventListener('click', () => {
      const showTable = table.hidden;
      table.hidden = !showTable;
      chart.hidden = showTable;
      btn.textContent = showTable ? 'Chart' : 'Table';
      btn.setAttribute('aria-pressed', String(showTable));
      hideTip();
      if (!showTable) { const fn = redraw.get(chart); if (fn && chart.querySelector('svg')) fn(); }
    });
  });

  el('btnBackup').addEventListener('click', doBackup);
  el('btnBannerBackup').addEventListener('click', doBackup);
  el('btnRestore').addEventListener('click', () => el('fileRestore').click());
  el('fileRestore').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = await SNBackup.import(file);
      if (window.SNCloud) SNCloud.queueMany(result.changed);
      demo = false;
      render();
      backupMsg(SNBackup.summary(result));
    } catch (err) {
      backupMsg(err.message, true);
    }
  });

  const startDemo = () => { demo = true; render(); window.scrollTo(0, 0); };
  el('btnDemo').addEventListener('click', startDemo);
  el('btnDemoLink').addEventListener('click', startDemo);
  el('btnExitDemo').addEventListener('click', () => { demo = false; render(); });

  // Bills saved in another tab / coming back from the bill page
  window.addEventListener('sn:data-changed', () => { if (!demo) render(); });
  window.addEventListener('storage', e => { if (!demo && (!e.key || e.key === BILLS_KEY)) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !demo) render(); });
  window.addEventListener('pageshow', e => { if (e.persisted && !demo) render(); });

  if (window.SNCloud) SNCloud.onChange(() => renderBackup());
  el('cloudBannerBtn').addEventListener('click', () => { if (window.SNCloud) SNCloud.open(); });

  render();
})();
