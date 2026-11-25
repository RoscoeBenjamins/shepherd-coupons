/* SHEPHERD LOCALS — Coupon sales & redemption front end (plain JS, no build step) */

// ▼▼▼ PASTE YOUR APPS SCRIPT WEB-APP URL HERE (ends in /exec) ▼▼▼
const API_URL = 'https://script.google.com/macros/s/AKfycbzZZzFFz6m_AFHACgIZByjJrUJ-UKJz-cB63J2BLT4Pf4S5y_0fMpQCWv-P40shdB2A/exec';
// ▲▲▲ This public URL is the only thing the front end needs. No Sheet ID, no secrets. ▲▲▲

const API = window.SL_API_OVERRIDE || API_URL;
const TZ = 'Africa/Accra';
const COUPONS_PER_BOOKLET = 45;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => n === null || n === undefined || n === '' ? '—' : 'GHS ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const normSerial = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const isBookletId = (s) => /^(GLD|SLV)-\d{4}-B\d{2}$/.test(s);

// Login survives closing the app (installed or not) but never longer than the server session (6 h).
const SESSION_MS = 6 * 3600 * 1000;
const sess = {
  get(k) { try { if (Number(localStorage.getItem('sl_exp') || 0) < Date.now()) { this.clear(); return null; } return localStorage.getItem(k); } catch (e) { return null; } },
  save(token, user) { try { localStorage.setItem('sl_token', token); localStorage.setItem('sl_user', JSON.stringify(user)); localStorage.setItem('sl_exp', String(Date.now() + SESSION_MS)); } catch (e) {} },
  clear() { try { ['sl_token', 'sl_user', 'sl_exp'].forEach((k) => localStorage.removeItem(k)); } catch (e) {} },
};
const state = {
  token: sess.get('sl_token'), user: JSON.parse(sess.get('sl_user') || 'null'),
  customers: [], booklets: [], tx: [], txStaff: [],
  sell: { items: [], prices: {}, touched: {}, method: null, status: null },
};

// ------------------------------------------------------------------ API
async function api(action, params = {}) {
  if (!API || API.startsWith('PASTE_')) throw new Error('API_URL is not set in app.js.');
  let res;
  try {
    // text/plain body = "simple" request: no CORS pre-flight, which Apps Script cannot answer
    res = await fetch(API, { method: 'POST', body: JSON.stringify({ action, token: state.token, ...params }) });
  } catch (e) { throw new Error('Network problem — check the internet connection and try again.'); }
  const data = await res.json();
  if (data.error === 'SESSION_EXPIRED') { logout(true); throw new Error('Session expired — please log in again.'); }
  return data;
}
function fail(data) { return new Error(data.message || data.error || 'Something went wrong.'); }

function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + (label || 'Working…'); }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.label || btn.innerHTML; }
}
function modal(html, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  const close = () => { root.innerHTML = ''; };
  $('.modal-bg', root).addEventListener('click', (e) => { if (e.target.classList.contains('modal-bg')) close(); });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
  if (onMount) onMount($('.modal', root), close);
  return close;
}
function confirmBox(title, bodyHtml, okLabel = 'Confirm', okClass = 'primary') {
  return new Promise((resolve) => {
    modal(`<h2>${esc(title)}</h2><div>${bodyHtml}</div>
      <div class="row" style="margin-top:1rem"><button class="btn quiet" data-close id="cbNo">Cancel</button>
      <button class="btn ${okClass}" id="cbYes">${esc(okLabel)}</button></div>`, (m, close) => {
      $('#cbYes', m).onclick = () => { close(); resolve(true); };
      $('#cbNo', m).onclick = () => { close(); resolve(false); };
    });
  });
}

// ------------------------------------------------------------------ login / shell
const ICONS = {
  redeem: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  sell: '<path d="M3 7.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 0 0 5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5.5a2.5 2.5 0 0 0 0-5z"/><path d="M15 5v14" stroke-dasharray="2 2.2"/>',
  dash: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5M16 4.3a3.5 3.5 0 0 1 0 7.4M18.5 14.2A5.5 5.5 0 0 1 21.5 19v1"/>',
  booklets: '<path d="M5 18.5V5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5 2.5 2.5 0 0 0 7.5 23H19"/><path d="M9 7h6"/>',
  log: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="18" r=".6"/>',
  staff: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.1-7.5 9.5-4.3-1.4-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
};
const svg = (paths, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${paths}</svg>`;
const TABS = [
  { id: 'redeem', label: 'Redeem', roles: ['Front Desk', 'Manager'] },
  { id: 'sell', label: 'Sell', roles: ['Front Desk', 'Manager'] },
  { id: 'dash', label: 'Dashboard', short: 'Stats', roles: ['Manager'] },
  { id: 'customers', label: 'Customers', short: 'Clients', roles: ['Manager'] },
  { id: 'booklets', label: 'Booklets', roles: ['Manager'] },
  { id: 'log', label: 'Log', roles: ['Manager'] },
  { id: 'staff', label: 'Staff', roles: ['Manager'] },
];

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#loginForm .btn');
  $('#loginMsg').innerHTML = '';
  busy(btn, true, 'Checking…');
  try {
    const r = await api('login', { name: $('#loginName').value, pin: $('#loginPin').value });
    if (!r.ok) throw fail(r);
    state.token = r.token; state.user = r.user;
    sess.save(r.token, r.user);
    $('#loginPin').value = '';
    startApp();
  } catch (err) { $('#loginMsg').innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
  finally { busy(btn, false); }
});

$('#logoutBtn').addEventListener('click', () => logout(false));
function logout(expired) {
  if (!expired && state.token) api('logout').catch(() => {});
  stopAllScanners();
  state.token = null; state.user = null; sess.clear();
  $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden');
  if (expired) $('#loginMsg').innerHTML = '<div class="alert warn">Your session expired. Please log in again.</div>';
}

function startApp() {
  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#whoName').textContent = state.user.name; $('#whoRole').textContent = state.user.role;
  $('#whoInitial').textContent = (state.user.name || '?').trim().charAt(0).toUpperCase();
  const tabs = TABS.filter((t) => t.roles.includes(state.user.role));
  $('#tabs').innerHTML = tabs.map((t) => `<button data-tab="${t.id}">${svg(ICONS[t.id])}<span class="lbl">${t.label}</span>${t.short ? `<span class="lbl-s">${t.short}</span>` : ''}</button>`).join('');
  document.body.dataset.tabs = tabs.length;
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  loadCustomers(); loadBooklets();
  showTab('redeem');
}

function showTab(id) {
  stopAllScanners();
  $$('#tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === id); b.toggleAttribute('aria-current', b.dataset.tab === id); });
  window.scrollTo(0, 0);
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + id));
  if (id === 'dash') loadDashboard();
  if (id === 'customers') renderCustomerTable();
  if (id === 'booklets') renderBookletList();
  if (id === 'log') loadLog();
  if (id === 'staff') loadStaff();
  if (id === 'sell') { loadBooklets(); loadCustomers(); }
}

// ------------------------------------------------------------------ camera scanner (html5-qrcode)
const scanners = {};
function scannerFormats() {
  const F = window.Html5QrcodeSupportedFormats;
  return F ? [F.QR_CODE] : undefined;   // coupons and booklet covers carry QR codes only
}
async function startScanner(elId, btn, onCode) {
  if (!window.Html5Qrcode) { toast('Scanner did not load — use manual entry.'); return; }
  if (scanners[elId]) { await stopScanner(elId, btn); return; }
  const sc = new Html5Qrcode(elId, { formatsToSupport: scannerFormats(), verbose: false, useBarCodeDetectorIfSupported: true,
                                      experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
  let last = '', lastAt = 0;
  scanners[elId] = { sc, btn, paused: false };
  try {
    await sc.start({ facingMode: 'environment' },
      { fps: 12, aspectRatio: 1.333, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h, 360) * 0.8); return { width: s, height: s }; } },   // square box for QR codes
      (text) => {
        const now = Date.now();
        if (text === last && now - lastAt < 2500) return;
        last = text; lastAt = now;
        if (navigator.vibrate) navigator.vibrate(60);
        onCode(text);
      }, () => {});
    document.getElementById(elId).classList.add('live');
    if (btn) btn.textContent = 'Stop camera';
  } catch (err) {
    delete scanners[elId];
    toast('Camera unavailable: ' + (err.message || err) + '. Use manual entry.', 4000);
  }
}
async function stopScanner(elId) {
  const s = scanners[elId]; if (!s) return;
  delete scanners[elId];
  try { await s.sc.stop(); s.sc.clear(); } catch (e) {}
  document.getElementById(elId).classList.remove('live');
  if (s.btn) s.btn.textContent = s.btn.id === 'redeemCamBtn' ? 'Start camera' : 'Scan';
}
function pauseScanner(elId, on) {
  const s = scanners[elId]; if (!s) return;
  try { on ? s.sc.pause(true) : s.sc.resume(); } catch (e) {}
}
function stopAllScanners() { Object.keys(scanners).forEach((id) => stopScanner(id)); }

// ------------------------------------------------------------------ REDEEM
$('#redeemCamBtn').addEventListener('click', (e) => startScanner('redeemScanner', e.currentTarget, handleRedeemCode));
$('#redeemManual').addEventListener('submit', (e) => {
  e.preventDefault(); const v = $('#redeemSerial').value; if (v.trim()) handleRedeemCode(v);
});

const V_OK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>', V_BAD = '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', V_WARN = '<path d="M12 7v6.5M12 17.2v.3"/>', V_TURN = '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9.5a4.5 4.5 0 0 1 0 9H11"/>';
const VERDICTS = {
  VALID: { cls: 'ok', icon: V_OK, title: 'VALID' },
  REDEEMED: { cls: 'ok', icon: V_OK, title: 'REDEEMED' },
  ALREADY_REDEEMED: { cls: 'bad', icon: V_BAD, title: 'ALREADY REDEEMED' },
  NOT_SOLD: { cls: 'bad', icon: V_BAD, title: 'NOT SOLD', msg: 'This coupon is still in stock — it was never sold. Do not accept it.' },
  VOID: { cls: 'bad', icon: V_BAD, title: 'VOID', msg: 'This coupon has been cancelled by the manager. Do not accept it.' },
  UNKNOWN: { cls: 'bad', icon: V_BAD, title: 'UNKNOWN SERIAL', msg: 'Not in the register. Do not accept it.' },
  INVALID: { cls: 'warn', icon: V_WARN, title: 'CHECK THE SERIAL', msg: 'This is not a valid Shepherd Locals serial. Re-scan or re-type it carefully.' },
  MAPS_QR: { cls: 'warn', icon: V_TURN, title: 'WRONG SIDE', msg: 'That is the Google Maps QR on the back. Turn the coupon over and scan the QR code next to the serial number.' },
};

async function handleRedeemCode(raw) {
  pauseScanner('redeemScanner', true);
  const box = $('#redeemResult');
  box.innerHTML = '<div class="result checking"><span class="spinner dark"></span> Checking…</div>';
  try {
    const r = await api('lookup', { serial: raw });
    if (!r.ok) throw fail(r);
    renderRedeemResult(r.verdict, r.coupon, r.serial || normSerial(raw));
  } catch (err) { box.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; pauseScanner('redeemScanner', false); }
}

function renderRedeemResult(verdict, c, serial) {
  const v = VERDICTS[verdict] || VERDICTS.UNKNOWN;
  let meta = '';
  if (c && (verdict === 'VALID' || verdict === 'REDEEMED')) {
    meta = `<div><span class="chip ${esc(c.tier)}">${esc(c.tier)}</span></div>
            <div class="soldto">Sold to <b>${esc(c.sold_to || '—')}</b></div>
            <div class="small">Booklet ${esc(c.booklet_serial)} · coupon ${esc(c.coupon_no)}</div>`;
    if (verdict === 'REDEEMED') meta += `<div class="small">Redeemed ${esc(when(c.redeemed_at))} by ${esc(c.redeemed_by)}</div>`;
  } else if (c && verdict === 'ALREADY_REDEEMED') {
    meta = `<div>Redeemed <b>${esc(when(c.redeemed_at))}</b></div><div>by <b>${esc(c.redeemed_by || '—')}</b></div>
            <div class="small">Sold to ${esc(c.sold_to || '—')} · ${esc(c.tier)}</div>`;
  } else {
    meta = `<div>${esc(v.msg || '')}</div>`;
  }
  const actions = verdict === 'VALID'
    ? `<div class="actions"><button class="btn quiet big" id="rdCancel">Cancel</button><button class="btn ok big" id="rdConfirm">Confirm redemption</button></div>`
    : `<button class="btn primary big" id="rdNext">Scan next coupon</button>`;
  $('#redeemResult').innerHTML = `<div class="result ${v.cls}"><div class="icon">${svg(v.icon)}</div><div class="title">${v.title}</div>
      <div class="serial">${esc(serial)}</div><div class="meta">${meta}</div>${actions}</div>`;
  if (window.innerWidth < 900) $('#redeemResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
  const next = () => { $('#redeemResult').innerHTML = ''; $('#redeemSerial').value = ''; pauseScanner('redeemScanner', false); };
  if ($('#rdNext')) $('#rdNext').onclick = next;
  if ($('#rdCancel')) $('#rdCancel').onclick = next;
  if ($('#rdConfirm')) $('#rdConfirm').onclick = async (e) => {
    busy(e.currentTarget, true, 'Redeeming…');
    try {
      const r = await api('redeem', { serial });
      renderRedeemResult(r.verdict, r.coupon, serial);   // server decides: REDEEMED or ALREADY_REDEEMED etc.
    } catch (err) { $('#redeemResult').insertAdjacentHTML('beforeend', `<div class="alert bad">${esc(err.message)}</div>`); }
  };
}

// ------------------------------------------------------------------ SELL
// One order can hold Gold and Silver booklets and single coupons together. The server receives one
// "line" per (type, tier) — e.g. Gold booklets ×3, Silver booklets ×2, Silver singles ×4 — each with its own price.
async function loadBooklets() {
  try { const r = await api('listBooklets'); if (r.ok) { state.booklets = r.booklets; renderBookletPick(); } } catch (e) {}
}
async function loadCustomers() {
  try { const r = await api('listCustomers'); if (r.ok) { state.customers = r.customers; renderCustomerSelect(); } } catch (e) {}
}

const TIER_ORDER = ['GOLD', 'SILVER'];
const tierName = (t) => t === 'GOLD' ? 'Gold' : 'Silver';
const LINE_DEFS = [
  { type: 'Full Booklet', tier: 'GOLD' }, { type: 'Full Booklet', tier: 'SILVER' },
  { type: 'Single Coupons', tier: 'GOLD' }, { type: 'Single Coupons', tier: 'SILVER' },
];
const lineKey = (type, tier) => type + '|' + tier;
const isAvail = (b) => b.status === 'In Stock' && b.in_stock === COUPONS_PER_BOOKLET;
const shortBk = (id) => id.slice(-3);              // GLD-2026-B03 -> B03

function cartBooklets(tier) { return state.sell.items.filter((i) => i.kind === 'booklet' && (!tier || i.tier === tier)); }
function cartSingles(tier) { return state.sell.items.filter((i) => i.kind === 'single' && (!tier || i.tier === tier)); }

function orderLines() {
  const cust = state.customers.find((x) => x.customer_id === $('#custSelect').value);
  return LINE_DEFS.map((d) => {
    const items = d.type === 'Full Booklet' ? cartBooklets(d.tier) : cartSingles(d.tier);
    if (!items.length) return null;
    const key = lineKey(d.type, d.tier);
    const rate = cust ? cust[d.tier.toLowerCase() + (d.type === 'Full Booklet' ? '_booklet_rate' : '_single_rate')] ?? null : null;
    const raw = state.sell.prices[key];
    const price = raw === undefined || raw === '' ? null : Number(raw);
    return { ...d, key, items, qty: items.length, rate, price,
             unit: d.type === 'Full Booklet' ? 'booklet' : 'coupon',
             label: `${tierName(d.tier)} ${d.type === 'Full Booklet' ? 'booklets' : 'single coupons'}`,
             subtotal: price > 0 ? Math.round(price * items.length * 100) / 100 : 0,
             override: rate !== null && price !== null && Math.abs(price - rate) >= 0.005 };
  }).filter(Boolean);
}
function orderTotal(lines = orderLines()) { return Math.round(lines.reduce((a, l) => a + l.subtotal, 0) * 100) / 100; }

function renderBookletPick() {
  const el = $('#bookletPick'); if (!el) return;
  if (!state.booklets.length) { el.innerHTML = '<p class="hint">Loading booklets…</p>'; return; }
  el.innerHTML = TIER_ORDER.map((tier) => {
    const all = state.booklets.filter((b) => b.tier === tier);
    const avail = all.filter(isAvail).length, n = cartBooklets(tier).length;
    return `<div class="tierblock ${tier}">
      <div class="tb-head"><span class="medal ${tier}" aria-hidden="true"></span>
        <div><b>${tierName(tier)}</b><span class="hint">${avail} of ${all.length} in stock</span></div>
        <div class="stepper" role="group" aria-label="${tierName(tier)} booklets">
          <button type="button" data-dec="${tier}" aria-label="One fewer ${tierName(tier)} booklet" ${n ? '' : 'disabled'}>−</button>
          <output class="num" data-count="${tier}">${n}</output>
          <button type="button" data-inc="${tier}" aria-label="One more ${tierName(tier)} booklet" ${n < avail ? '' : 'disabled'}>+</button>
        </div></div>
      <div class="bk-row">${all.map((b) => {
        const on = state.sell.items.some((i) => i.kind === 'booklet' && i.booklet_serial === b.booklet_serial);
        const ok = isAvail(b);
        const why = ok ? 'In stock' : (b.status === 'Sold' ? 'Sold' + (b.sold_to ? ' to ' + b.sold_to : '') : b.status);
        return `<button type="button" data-b="${esc(b.booklet_serial)}" class="bk ${on ? 'on' : ''}" ${ok ? '' : 'disabled'}
          aria-pressed="${on}" title="${esc(b.booklet_serial)} · ${esc(why)}"><b>${esc(shortBk(b.booklet_serial))}</b><span>${ok ? (on ? 'Added' : 'Add') : esc(b.status === 'Sold' ? 'Sold' : 'Opened')}</span></button>`;
      }).join('')}</div></div>`;
  }).join('');
  $$('#bookletPick [data-b]').forEach((btn) => btn.addEventListener('click', () => toggleBooklet(btn.dataset.b)));
  $$('#bookletPick [data-inc]').forEach((btn) => btn.addEventListener('click', () => stepBooklets(btn.dataset.inc, +1)));
  $$('#bookletPick [data-dec]').forEach((btn) => btn.addEventListener('click', () => stepBooklets(btn.dataset.dec, -1)));
}

function stepBooklets(tier, dir) {
  const s = state.sell; $('#saleResult').innerHTML = '';
  if (dir > 0) {
    const next = state.booklets.filter((b) => b.tier === tier && isAvail(b) && !s.items.some((i) => i.kind === 'booklet' && i.booklet_serial === b.booklet_serial))
      .sort((a, b) => a.booklet_serial.localeCompare(b.booklet_serial))[0];
    if (!next) return sellMsg('warn', `No more ${tierName(tier)} booklets in stock.`);
    addBooklet(next.booklet_serial);
  } else {
    const mine = cartBooklets(tier).sort((a, b) => a.booklet_serial.localeCompare(b.booklet_serial));
    if (!mine.length) return;
    const last = mine[mine.length - 1];
    s.items = s.items.filter((i) => i !== last); sellMsg();
  }
  refreshSell();
}

function addBooklet(id) {
  const s = state.sell;
  const b = state.booklets.find((x) => x.booklet_serial === id);
  if (!b) return sellMsg('bad', 'Unknown booklet ' + id + '.'), false;
  if (!isAvail(b)) return sellMsg('bad', `${id} is not available (${b.status}). Sell its remaining coupons as singles.`), false;
  const dropped = s.items.filter((i) => i.kind === 'single' && i.booklet_serial === id).length;
  s.items = s.items.filter((i) => !(i.kind === 'single' && i.booklet_serial === id));
  s.items.push({ kind: 'booklet', booklet_serial: id, tier: b.tier });
  sellMsg('ok', `${id} added${dropped ? ` — replaced ${dropped} single coupon${dropped > 1 ? 's' : ''} from it` : ''}.`);
  return true;
}

function toggleBooklet(id) {
  const s = state.sell; $('#saleResult').innerHTML = '';
  const i = s.items.findIndex((x) => x.kind === 'booklet' && x.booklet_serial === id);
  if (i >= 0) { s.items.splice(i, 1); sellMsg(); } else addBooklet(id);
  refreshSell();
}

$('#sellCamBtn').addEventListener('click', (e) => startScanner('sellScanner', e.currentTarget, (t) => addToCart(t)));
$('#sellManual').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#sellSerial').value; if (v.trim()) addToCart(v); $('#sellSerial').value = ''; });

function sellMsg(kind, html, isHtml) {
  $('#sellMsg').innerHTML = kind ? `<div class="alert ${kind}">${isHtml ? html : esc(html)}</div>` : '';
}

async function addToCart(raw) {
  const s = state.sell, code = normSerial(raw);
  $('#saleResult').innerHTML = '';
  if (/^HTTPS?:/.test(code)) return sellMsg('warn', 'That is the Google Maps QR on the back — scan the QR code on the front.');
  if (isBookletId(code)) {
    if (s.items.some((i) => i.kind === 'booklet' && i.booklet_serial === code)) return sellMsg('warn', code + ' is already in this order.');
    if (!state.booklets.length) await loadBooklets();
    addBooklet(code); return refreshSell();
  }
  try {
    const r = await api('lookup', { serial: code });
    if (!r.ok) throw fail(r);
    const c = r.coupon;
    if (!c) return sellMsg('bad', r.verdict === 'INVALID' ? `${code} is not a valid serial — check it.` : `${code} is not in the register.`);
    if (s.items.some((i) => i.kind === 'booklet' && i.booklet_serial === c.booklet_serial)) return sellMsg('warn', `${c.serial} is already in this order inside booklet ${c.booklet_serial}.`);
    if (c.status !== 'In Stock') return sellMsg('bad', `${code} cannot be sold — it is ${c.status}${c.sold_to ? ' (to ' + c.sold_to + ')' : ''}.`);
    if (s.items.some((i) => i.serial === c.serial)) return sellMsg('warn', code + ' is already in this order.');
    s.items.push({ kind: 'single', serial: c.serial, tier: c.tier, booklet_serial: c.booklet_serial, coupon_no: c.coupon_no });
    const bk = state.booklets.find((b) => b.booklet_serial === c.booklet_serial);
    if (bk && isAvail(bk)) {
      sellMsg('ok', `${esc(c.serial)} added as a single ${esc(tierName(c.tier))} coupon.
        <button type="button" class="linkbtn" id="wholeBk">Sell the whole booklet ${esc(c.booklet_serial)} instead</button>`, true);
      $('#wholeBk').onclick = () => { addBooklet(c.booklet_serial); refreshSell(); };
    } else sellMsg('ok', `${c.serial} added as a single ${tierName(c.tier)} coupon.`);
    refreshSell();
  } catch (err) { sellMsg('bad', err.message); }
}

function renderSingles() {
  const list = cartSingles();
  $('#singlesList').innerHTML = list.map((it) => `<li><span class="chip ${esc(it.tier)}">${esc(tierName(it.tier))}</span>
     <code>${esc(it.serial)}</code><span class="hint">${esc(shortBk(it.booklet_serial))} · #${esc(it.coupon_no)}</span>
     <button type="button" class="x" data-rm="${esc(it.serial)}" aria-label="Remove ${esc(it.serial)}">×</button></li>`).join('');
  $$('#singlesList [data-rm]').forEach((b) => b.addEventListener('click', () => {
    state.sell.items = state.sell.items.filter((i) => i.serial !== b.dataset.rm); refreshSell(); }));
}

function renderCustomerSelect() {
  const sel = $('#custSelect'), cur = sel.value;
  sel.innerHTML = '<option value="">Choose a customer…</option>' + state.customers.map((c) =>
    `<option value="${esc(c.customer_id)}">${esc(c.name)} (${esc(c.type)})</option>`).join('');
  if (cur) sel.value = cur;
  const fc = $('#fCust');
  if (fc) { const v = fc.value; fc.innerHTML = '<option value="">All</option>' + state.customers.map((c) => `<option value="${esc(c.customer_id)}">${esc(c.name)}</option>`).join(''); fc.value = v; }
}
$('#custSelect').addEventListener('change', () => { state.sell.touched = {}; refreshSell(); });
$('#newCustBtn').addEventListener('click', () => customerModal(null, (c) => { $('#custSelect').value = c.customer_id; state.sell.touched = {}; refreshSell(); }));

function renderLines() {
  const s = state.sell, lines = orderLines();
  const cust = state.customers.find((x) => x.customer_id === $('#custSelect').value);
  // agreed rates fill in until the person types their own price
  lines.forEach((l) => { if (!s.touched[l.key]) s.prices[l.key] = l.rate !== null ? String(l.rate) : ''; });
  const fresh = orderLines();
  $('#orderLines').innerHTML = !fresh.length
    ? '<p class="empty">Nothing in this order yet. Add booklets above, or scan single coupons.</p>'
    : fresh.map((l) => `<div class="line ${l.tier}" data-line="${esc(l.key)}">
        <div class="line-head"><span class="medal ${l.tier}" aria-hidden="true"></span><b>${esc(l.label)}</b>
          <span class="qty num">× ${l.qty}</span></div>
        <div class="line-sub">${l.type === 'Full Booklet' ? esc(l.items.map((i) => shortBk(i.booklet_serial)).join(', ')) + ` · ${l.qty * COUPONS_PER_BOOKLET} coupons` : `${l.qty} coupon${l.qty > 1 ? 's' : ''}`}</div>
        <div class="line-price">
          <label for="price_${esc(l.key.replace(/\W/g, ''))}">Price per ${l.unit}</label>
          <div class="money-in"><span>GHS</span><input id="price_${esc(l.key.replace(/\W/g, ''))}" data-price="${esc(l.key)}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Required" value="${esc(s.prices[l.key] ?? '')}"></div>
          <b class="subtotal num" data-sub="${esc(l.key)}">${money(l.subtotal)}</b>
        </div>
        <div class="line-note" data-note="${esc(l.key)}">${lineNote(l, cust)}</div>
      </div>`).join('');
  $$('#orderLines [data-price]').forEach((inp) => inp.addEventListener('input', () => {
    s.prices[inp.dataset.price] = inp.value; s.touched[inp.dataset.price] = true; updateTotals(); }));
  updateTotals();
}
function lineNote(l, cust) {
  if (!cust) return '<span class="hint">Choose the customer to load their agreed rate.</span>';
  if (l.override) return `<span class="chip warn">Override</span> <span class="hint">Agreed rate is ${money(l.rate)} — this sale will be flagged.</span>`;
  if (l.rate !== null) return `<span class="hint">Agreed rate for ${esc(cust.name)}.</span>`;
  return `<span class="hint">No agreed rate — type the price agreed for this sale.</span>`;
}
function updateTotals() {
  const lines = orderLines(), cust = state.customers.find((x) => x.customer_id === $('#custSelect').value);
  lines.forEach((l) => {
    const sub = $(`[data-sub="${CSS.escape(l.key)}"]`); if (sub) sub.textContent = money(l.subtotal);
    const note = $(`[data-note="${CSS.escape(l.key)}"]`); if (note) note.innerHTML = lineNote(l, cust);
  });
  const total = orderTotal(lines);
  $('#saleTotal').textContent = money(total);
  const nb = cartBooklets().length, ns = cartSingles().length, coupons = nb * COUPONS_PER_BOOKLET + ns;
  const parts = [];
  if (nb) parts.push(`${nb} booklet${nb > 1 ? 's' : ''}`);
  if (ns) parts.push(`${ns} single${ns > 1 ? 's' : ''}`);
  $('#orderBarText').innerHTML = parts.length ? `<b>${parts.join(' + ')}</b><span>${coupons} coupons · ${money(total)}</span>` : '';
  $('#orderBar').classList.toggle('hidden', !parts.length);
}
$('#orderBarGo').addEventListener('click', () => $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' }));

function refreshSell() { renderBookletPick(); renderSingles(); renderLines(); }

function segPick(id, key) {
  $(id).addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    state.sell[key] = v; $$(id + ' button').forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v); });
    if (key === 'status') $('#amountPaidWrap').classList.toggle('hidden', v !== 'Part-paid');
  });
}
segPick('#payMethod', 'method'); segPick('#payStatus', 'status');

$('#confirmSale').addEventListener('click', async (e) => {
  const s = state.sell, lines = orderLines(), total = orderTotal(lines);
  const cust = state.customers.find((x) => x.customer_id === $('#custSelect').value);
  $('#saleResult').innerHTML = '';
  const problems = [];
  if (!lines.length) problems.push('Add at least one booklet or coupon.');
  if (!cust) problems.push('Choose the customer.');
  lines.forEach((l) => { if (!(l.price > 0)) problems.push(`Enter the price per ${l.unit} for ${l.label}.`); });
  if (!s.method) problems.push('Choose a payment method.');
  if (!s.status) problems.push('Choose a payment status.');
  const paid = Number($('#amountPaid').value);
  if (s.status === 'Part-paid' && !(paid > 0 && paid < total)) problems.push(`Enter the amount received (more than 0, less than ${money(total)}).`);
  if (problems.length) { $('#saleResult').innerHTML = `<div class="alert bad">${problems.map(esc).join('<br>')}</div>`; return; }
  const coupons = lines.reduce((a, l) => a + (l.type === 'Full Booklet' ? l.qty * COUPONS_PER_BOOKLET : l.qty), 0);
  const ok = await confirmBox('Confirm sale', `
    <p class="cb-cust"><b>${esc(cust.name)}</b><span class="hint">${coupons} coupons</span></p>
    <table class="cb-lines">${lines.map((l) => `<tr><td><span class="chip ${l.tier}">${tierName(l.tier)}</span> ${esc(l.type === 'Full Booklet' ? 'Booklets' : 'Singles')}
      ${l.type === 'Full Booklet' ? `<div class="hint">${esc(l.items.map((i) => i.booklet_serial).join(', '))}</div>` : ''}</td>
      <td class="r num">${l.qty} × ${money(l.price)}${l.override ? ' <span class="chip warn">Override</span>' : ''}</td><td class="r num"><b>${money(l.subtotal)}</b></td></tr>`).join('')}
      <tr class="cb-total"><td colspan="2">Total</td><td class="r num"><b>${money(total)}</b></td></tr></table>
    <p class="hint">${esc(s.method)} · ${esc(s.status)}${s.status === 'Part-paid' ? ' — ' + money(paid) + ' received now' : ''}</p>`, 'Confirm sale');
  if (!ok) return;
  const btn = e.currentTarget; busy(btn, true, 'Saving sale…');
  try {
    const r = await api('sell', {
      customer_id: cust.customer_id, payment_method: s.method, payment_status: s.status,
      amount_paid: paid || 0, notes: $('#saleNotes').value,
      lines: lines.map((l) => ({ sale_type: l.type, unit_price: l.price,
        booklets: l.type === 'Full Booklet' ? l.items.map((i) => i.booklet_serial) : [],
        serials: l.type === 'Single Coupons' ? l.items.map((i) => i.serial) : [] })),
    });
    if (!r.ok) throw fail(r);
    const o = r.order || { order_id: r.sale.sale_id, coupon_count: r.sale.coupon_count, buyer_name: r.sale.buyer_name, total_amount: r.sale.total_amount, payment_status: r.sale.payment_status, lines: [r.sale] };
    $('#saleResult').innerHTML = `<div class="alert ok sale-done"><b>Sale saved · ${esc(o.order_id)}</b>
      ${o.coupon_count} coupons to ${esc(o.buyer_name)} — ${money(o.total_amount)} (${esc(o.payment_status)}).
      ${o.lines.length > 1 ? `<div class="hint">${o.lines.map((x) => `${esc(x.sale_id)}: ${esc(tierName(x.tier))} ${x.sale_type === 'Full Booklet' ? 'booklets' : 'singles'} × ${x.quantity}`).join(' · ')}</div>` : ''}
      ${o.lines.some((x) => x.price_overridden) ? '<div class="hint">Price override recorded.</div>' : ''}</div>`;
    s.items = []; s.prices = {}; s.touched = {}; $('#saleNotes').value = ''; $('#amountPaid').value = '';
    sellMsg(); await loadBooklets(); refreshSell();
    $('#saleResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) { $('#saleResult').innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
  finally { busy(btn, false); }
});

// ------------------------------------------------------------------ customers (add: everyone; rates: manager)
const RATE_FIELDS = [['gold_booklet_rate', 'Gold — per booklet'], ['silver_booklet_rate', 'Silver — per booklet'],
                     ['gold_single_rate', 'Gold — per single coupon'], ['silver_single_rate', 'Silver — per single coupon']];
function customerModal(c, onSaved) {
  const mgr = state.user.role === 'Manager';
  modal(`<h2>${c ? 'Edit customer' : 'New customer'}</h2>
    <div class="field"><label>Type</label><select id="cmType"><option>Company</option><option>Individual</option></select></div>
    <div class="field"><label>Name *</label><input id="cmName" value="${esc(c?.name)}"></div>
    <div class="row"><div class="field"><label>Contact person</label><input id="cmContact" value="${esc(c?.contact_person)}"></div>
      <div class="field"><label>Phone</label><input id="cmPhone" inputmode="tel" value="${esc(c?.phone)}"></div></div>
    ${mgr ? `<h3>Agreed rates (GHS, optional)</h3><div class="row">${RATE_FIELDS.map(([k, l]) =>
      `<div class="field"><label>${l}</label><input id="cm_${k}" type="number" min="0" step="0.01" inputmode="decimal" value="${c?.[k] ?? ''}"></div>`).join('')}</div>`
      : '<p class="small muted">Agreed rates can only be set by the manager.</p>'}
    <div class="field"><label>Notes</label><input id="cmNotes" value="${esc(c?.notes)}"></div>
    <div id="cmMsg"></div>
    <div class="row"><button class="btn quiet" data-close>Cancel</button><button class="btn primary" id="cmSave">Save</button></div>`, (m, close) => {
    $('#cmType', m).value = c?.type || 'Company';
    $('#cmSave', m).onclick = async (e) => {
      const body = { type: $('#cmType', m).value, name: $('#cmName', m).value, contact_person: $('#cmContact', m).value,
                     phone: $('#cmPhone', m).value, notes: $('#cmNotes', m).value };
      if (mgr) RATE_FIELDS.forEach(([k]) => { body[k] = $('#cm_' + k, m).value; });
      busy(e.currentTarget, true, 'Saving…');
      try {
        const r = c ? await api('updateCustomer', { customer_id: c.customer_id, ...body }) : await api('addCustomer', body);
        if (!r.ok) throw fail(r);
        await loadCustomers(); close(); toast('Customer saved'); onSaved && onSaved(r.customer); renderCustomerTable();
      } catch (err) { $('#cmMsg', m).innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; busy(e.currentTarget, false); }
    };
  });
}
$('#addCustBtn2').addEventListener('click', () => customerModal(null));
function renderCustomerTable() {
  if (state.user?.role !== 'Manager') return;
  $('#custTable').innerHTML = `<thead><tr><th>Name</th><th>Type</th><th>Contact</th>
    ${RATE_FIELDS.map(([, l]) => `<th class="r">${l}</th>`).join('')}<th></th></tr></thead><tbody>` +
    (state.customers.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.customer_id)}</div></td><td>${esc(c.type)}</td>
      <td>${esc(c.contact_person)}<div class="small muted">${esc(c.phone)}</div></td>
      ${RATE_FIELDS.map(([k]) => `<td class="r num">${c[k] === null ? '<span class="muted">—</span>' : money(c[k])}</td>`).join('')}
      <td><button class="btn quiet sm" data-edit="${esc(c.customer_id)}">Edit</button></td></tr>`).join('') ||
     '<tr><td colspan="8" class="muted">No customers yet.</td></tr>') + '</tbody>';
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => customerModal(state.customers.find((c) => c.customer_id === b.dataset.edit))));
}

// ------------------------------------------------------------------ DASHBOARD
$('#dashRefresh').addEventListener('click', loadDashboard);
async function loadDashboard() {
  const body = $('#dashBody');
  try {
    const d = await api('dashboard'); if (!d.ok) throw fail(d);
    const t = d.tiers;
    const tierCard = (k) => { const x = t[k]; return `<section class="card tiercard ${k}">
      <div class="tc-head"><span class="medal ${k}" aria-hidden="true"></span><h2>${tierName(k)}</h2>
        <span class="hint">${x.total} coupons printed</span></div>
      <dl class="stats">
        <div><dt>Sold</dt><dd class="num">${x.sold_ever}</dd></div>
        <div><dt>Redeemed</dt><dd class="num">${x.redeemed}</dd></div>
        <div><dt>Outstanding</dt><dd class="num">${x.outstanding}</dd></div>
        <div><dt>In stock</dt><dd class="num">${x.in_stock}</dd></div>
      </dl>
      <div class="meter-row"><span>Redemption rate</span><b class="num">${x.redemption_rate}%</b></div>
      <div class="bar" role="img" aria-label="Redemption rate ${x.redemption_rate}%"><i style="width:${Math.min(100, x.redemption_rate)}%"></i></div>
      <p class="tc-money">Revenue <b class="num">${money(x.revenue)}</b><span>Paid ${money(x.paid)} · Owed ${money(x.balance)}${x.void ? ` · ${x.void} void` : ''}</span></p>
    </section>`; };
    const kv = (obj) => Object.keys(obj).length ? Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r num">${money(v)}</td></tr>`).join('') : '<tr><td class="muted">No sales yet</td><td></td></tr>';
    body.innerHTML = `
      <div class="money-band">
        <div><span>Total billed</span><b class="num">${money(d.totals.revenue)}</b></div>
        <div><span>Received</span><b class="num">${money(d.totals.paid)}</b></div>
        <div class="${d.totals.balance > 0 ? 'owed' : ''}"><span>Owed to us</span><b class="num">${money(d.totals.balance)}</b></div>
      </div>
      <div class="grid2">${tierCard('GOLD')}${tierCard('SILVER')}</div>
      <section class="card"><h2>Redemptions per day <span class="hint">last 30 days</span></h2>${dailyChart(d.daily)}</section>
      <div class="grid2">
        <section class="card"><h2>By payment method</h2><table class="kv">${kv(d.by_method)}</table></section>
        <section class="card"><h2>By payment status</h2><table class="kv">${kv(d.by_payment_status)}</table></section>
      </div>
      <section class="card flush"><h2 class="pad">Per customer</h2><div class="tablewrap"><table><thead><tr><th>Customer</th><th class="r">Bought</th><th class="r">Redeemed</th>
        <th class="r">Outstanding</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Owes</th><th class="r">Avg / coupon</th></tr></thead><tbody>
        ${d.companies.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="hint">${c.gold ? c.gold + ' Gold ' : ''}${c.silver ? c.silver + ' Silver' : ''}</div></td>
          <td class="r num">${c.bought}</td><td class="r num">${c.redeemed} <span class="hint">(${c.redemption_rate}%)</span></td>
          <td class="r num">${c.outstanding}</td><td class="r num">${money(c.billed)}</td><td class="r num">${money(c.paid)}</td>
          <td class="r num">${c.balance > 0 ? `<b class="owe">${money(c.balance)}</b>` : money(0)}</td><td class="r num">${money(c.avg_price)}</td></tr>`).join('')
          || '<tr><td colspan="8" class="muted">No sales yet.</td></tr>'}</tbody></table></div></section>
      <p class="hint">Updated ${esc(when(d.generated_at))}</p>`;
  } catch (err) { body.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
}

function dailyChart(days) {
  const W = Math.round(Math.max(320, Math.min(760, ($('#dashBody')?.clientWidth || 720) - 40))), H = W < 500 ? 200 : 220, P = { l: 28, r: 8, t: 10, b: 28 };
  const max = Math.max(1, ...days.map((d) => d.GOLD + d.SILVER));
  const bw = (W - P.l - P.r) / days.length, sy = (H - P.t - P.b) / max;
  const ticks = [0, Math.ceil(max / 2), max];
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Redemptions per day">`;
  ticks.forEach((v) => { const y = H - P.b - v * sy; s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#E6E3DF"/><text x="${P.l - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="#6B7280">${v}</text>`; });
  days.forEach((d, i) => {
    const x = P.l + i * bw + 2, w = Math.max(2, bw - 4), hs = d.SILVER * sy, hg = d.GOLD * sy, base = H - P.b;
    const tip = `${d.date}: ${d.GOLD} Gold, ${d.SILVER} Silver`;
    if (hs) s += `<rect x="${x}" y="${base - hs}" width="${w}" height="${hs}" rx="2" fill="#8C96A3"><title>${tip}</title></rect>`;
    if (hg) s += `<rect x="${x}" y="${base - hs - hg}" width="${w}" height="${hg}" rx="2" fill="#D89A10"><title>${tip}</title></rect>`;
    if (!hs && !hg) s += `<rect x="${x}" y="${base - 1}" width="${w}" height="1" fill="#E6E3DF"><title>${tip}</title></rect>`;
    if (i % (W < 500 ? 7 : 5) === 0 || i === days.length - 1) s += `<text x="${x + w / 2}" y="${H - 9}" font-size="11" text-anchor="middle" fill="#6B7280">${d.date.slice(5)}</text>`;
  });
  return s + `</svg><div class="legend"><span><i style="background:#D89A10"></i>Gold</span><span><i style="background:#8C96A3"></i>Silver</span></div>`;
}

// ------------------------------------------------------------------ BOOKLETS (manager)
async function renderBookletList() {
  await loadBooklets();
  $('#bookletList').innerHTML = state.booklets.map((b) => `<button class="bkcard ${esc(b.tier)}" data-b="${esc(b.booklet_serial)}">
    <span class="medal ${esc(b.tier)}" aria-hidden="true"></span><b>${esc(b.booklet_serial)}</b>
    <span class="st">${esc(b.status)}${b.sold_to ? ' · ' + esc(b.sold_to) : ''}</span>
    <span class="bar thin"><i style="width:${Math.round(100 * b.in_stock / COUPONS_PER_BOOKLET)}%"></i></span>
    <span class="hint">${b.in_stock}/${COUPONS_PER_BOOKLET} in stock</span></button>`).join('');
  $$('#bookletList button').forEach((btn) => btn.addEventListener('click', () => showBooklet(btn.dataset.b)));
}
async function showBooklet(id) {
  const card = $('#bookletDetailCard'); card.classList.remove('hidden'); card.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api('bookletDetail', { booklet_serial: id }); if (!r.ok) throw fail(r);
    const b = r.booklet, count = (st) => r.coupons.filter((c) => c.status === st).length;
    card.innerHTML = `<h2>${esc(b.booklet_serial)} <span class="chip ${esc(b.tier)}">${esc(b.tier)}</span></h2>
      <p class="small">${esc(b.serial_range)} · <b>${esc(b.status)}</b>${b.sold_to ? ' to ' + esc(b.sold_to) : ''}${b.sale_id ? ' · sale ' + esc(b.sale_id) : ''}</p>
      <div class="legend"><span><i style="background:#fff"></i>In stock ${count('In Stock')}</span><span><i style="background:#FFF3E6"></i>Sold ${count('Sold')}</span>
        <span><i style="background:#E6F6EC"></i>Redeemed ${count('Redeemed')}</span><span><i style="background:#FDECEC"></i>Void ${count('Void')}</span></div>
      <div class="coupongrid">${r.coupons.map((c) => `<button class="cg st-${esc(c.status.replace(/\s/g, ''))}" data-s="${esc(c.serial)}">
        <b>#${String(c.coupon_no).padStart(3, '0')}</b>${esc(c.serial.slice(9))}<br>${esc(c.status)}</button>`).join('')}</div>`;
    $$('.cg', card).forEach((el) => el.addEventListener('click', () => couponModal(r.coupons.find((c) => c.serial === el.dataset.s), id)));
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { card.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
}
function couponModal(c, bookletId) {
  const canVoid = c.status === 'In Stock' || c.status === 'Sold';
  modal(`<h2><code>${esc(c.serial)}</code></h2>
    <table><tr><td>Tier</td><td><span class="chip ${esc(c.tier)}">${esc(c.tier)}</span></td></tr>
    <tr><td>Booklet</td><td>${esc(c.booklet_serial)} #${esc(c.coupon_no)}</td></tr><tr><td>Status</td><td><b>${esc(c.status)}</b></td></tr>
    <tr><td>Sold to</td><td>${esc(c.sold_to || '—')}</td></tr><tr><td>Sale</td><td>${esc(c.sale_id || '—')} ${c.sold_at ? '· ' + esc(when(c.sold_at)) : ''}</td></tr>
    <tr><td>Price paid</td><td>${money(c.unit_price)}</td></tr>
    <tr><td>Redeemed</td><td>${c.redeemed_at ? esc(when(c.redeemed_at)) + ' by ' + esc(c.redeemed_by) : '—'}</td></tr></table>
    ${canVoid ? `<div class="field" style="margin-top:1rem"><label>Void this coupon (lost / damaged / stolen) — reason</label><input id="voidReason"></div>` : ''}
    <div id="vMsg"></div>
    <div class="row" style="margin-top:.8rem"><button class="btn quiet" data-close>Close</button>${canVoid ? '<button class="btn bad" id="voidBtn">Void coupon</button>' : ''}</div>`, (m, close) => {
    const vb = $('#voidBtn', m); if (!vb) return;
    vb.onclick = async () => {
      const reason = $('#voidReason', m).value.trim();
      if (!reason) { $('#vMsg', m).innerHTML = '<div class="alert bad">Give a reason.</div>'; return; }
      busy(vb, true, 'Voiding…');
      try { const r = await api('voidCoupon', { serial: c.serial, reason }); if (!r.ok) throw fail(r); close(); toast(c.serial + ' voided'); showBooklet(bookletId); }
      catch (err) { $('#vMsg', m).innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; busy(vb, false); }
    };
  });
}

// ------------------------------------------------------------------ LOG (manager)
$('#logRefresh').addEventListener('click', loadLog);
['#fFrom', '#fTo', '#fKind', '#fTier', '#fCust', '#fStaff', '#fSerial', '#fOverride'].forEach((id) => $(id).addEventListener('input', renderLog));
async function loadLog() {
  $('#logTable').innerHTML = '<tr><td class="muted">Loading…</td></tr>';
  try {
    const r = await api('transactions'); if (!r.ok) throw fail(r);
    state.tx = r.transactions; state.txStaff = r.staff;
    const fs = $('#fStaff'), v = fs.value;
    fs.innerHTML = '<option value="">All</option>' + r.staff.map((s) => `<option>${esc(s)}</option>`).join(''); fs.value = v;
    renderCustomerSelect(); renderLog();
  } catch (err) { $('#logTable').innerHTML = `<tr><td class="alert bad">${esc(err.message)}</td></tr>`; }
}
function dayOf(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); }
function filteredTx() {
  const f = { from: $('#fFrom').value, to: $('#fTo').value, kind: $('#fKind').value, tier: $('#fTier').value, cust: $('#fCust').value,
              staff: $('#fStaff').value, q: normSerial($('#fSerial').value), ov: $('#fOverride').value };
  return state.tx.filter((t) => {
    const d = dayOf(t.timestamp);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.tier && t.tier !== f.tier) return false;
    if (f.cust && t.customer_id !== f.cust) return false;
    if (f.staff && t.staff !== f.staff) return false;
    if (f.ov && !t.price_overridden) return false;
    if (f.q && !(String(t.serials || '') + ' ' + String(t.sale_id || '') + ' ' + String(t.order_id || '') + ' ' + String(t.booklets || '')).toUpperCase().includes(f.q)) return false;
    return true;
  });
}
function renderLog() {
  const rows = filteredTx();
  const sales = rows.filter((t) => t.kind === 'Sale');
  const billed = sales.reduce((a, t) => a + Number(t.total_amount || 0), 0);
  $('#logCount').innerHTML = `${rows.length} entries · ${sales.length} sale lines (${money(billed)}) · ${rows.length - sales.length} redemptions`;
  $('#logTable').innerHTML = `<thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Tier</th><th>Details</th><th class="r">Qty</th>
    <th class="r">Unit price</th><th class="r">Total</th><th>Payment</th><th>Price</th><th>Staff</th></tr></thead><tbody>` +
    (rows.map((t) => t.kind === 'Sale'
      ? `<tr class="${t.price_overridden ? 'override' : ''}"><td class="small">${esc(when(t.timestamp))}<div class="muted">${esc(t.sale_id)}</div>${t.order_id && t.order_id !== t.sale_id ? `<div class="muted">order ${esc(t.order_id)}</div>` : ''}</td>
          <td><span class="chip">Sale</span></td><td>${esc(t.customer)}</td><td><span class="chip ${esc(t.tier)}">${esc(t.tier)}</span></td>
          <td class="small">${esc(t.sale_type)}${t.booklets ? ': ' + esc(t.booklets) : ''}<div class="muted">${t.coupon_count} coupons</div></td>
          <td class="r num">${esc(t.quantity)}</td><td class="r num">${money(t.unit_price)}</td><td class="r num"><b>${money(t.total_amount)}</b></td>
          <td class="small">${esc(t.payment_method)}<br><span class="chip ${t.payment_status === 'Paid' ? 'ok' : t.payment_status === 'Unpaid' ? 'bad' : 'warn'}">${esc(t.payment_status)}</span>
            ${Number(t.balance) > 0 ? `<div>owes ${money(t.balance)}</div><button class="btn quiet sm" data-pay="${esc(t.sale_id)}">Record payment</button>` : ''}</td>
          <td class="small">${t.price_overridden ? `<span class="chip warn">Override</span><div class="muted">agreed ${money(t.agreed_rate)}</div>` : esc(t.price_source)}</td>
          <td class="small">${esc(t.staff)}</td></tr>`
      : `<tr><td class="small">${esc(when(t.timestamp))}</td><td><span class="chip ok">Redeemed</span></td><td>${esc(t.customer)}</td>
          <td><span class="chip ${esc(t.tier)}">${esc(t.tier)}</span></td><td class="small"><code>${esc(t.serials)}</code><div class="muted">${esc(t.booklets)}</div></td>
          <td class="r num">1</td><td></td><td></td><td></td><td></td><td class="small">${esc(t.staff)}</td></tr>`).join('')
     || '<tr><td colspan="11" class="muted">No matching entries.</td></tr>') + '</tbody>';
  $$('[data-pay]').forEach((b) => b.addEventListener('click', () => paymentModal(state.tx.find((t) => t.sale_id === b.dataset.pay && t.kind === 'Sale'))));
}
function paymentModal(t) {
  modal(`<h2>Record payment — ${esc(t.sale_id)}</h2><p>${esc(t.customer)} · total <b>${money(t.total_amount)}</b> · paid so far ${money(t.amount_paid)}</p>
    <div class="field"><label>Total amount paid to date (GHS)</label><input id="pmAmt" type="number" min="0" step="0.01" value="${esc(t.total_amount)}"></div>
    <div class="field"><label>Method</label><select id="pmMethod"><option>Cash</option><option>MoMo</option><option>Bank</option><option>Invoice/Credit</option></select></div>
    <div id="pmMsg"></div><div class="row"><button class="btn quiet" data-close>Cancel</button><button class="btn primary" id="pmSave">Save</button></div>`, (m, close) => {
    $('#pmMethod', m).value = t.payment_method || 'Cash';
    $('#pmSave', m).onclick = async (e) => {
      busy(e.currentTarget, true, 'Saving…');
      try { const r = await api('recordPayment', { sale_id: t.sale_id, amount_paid: $('#pmAmt', m).value, payment_method: $('#pmMethod', m).value });
        if (!r.ok) throw fail(r); close(); toast('Payment recorded — ' + r.payment_status); loadLog(); }
      catch (err) { $('#pmMsg', m).innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; busy(e.currentTarget, false); }
    };
  });
}
$('#logCsv').addEventListener('click', () => {
  const rows = filteredTx();
  const cols = ['kind', 'timestamp', 'sale_id', 'order_id', 'customer_id', 'customer', 'buyer_type', 'tier', 'sale_type', 'booklets', 'serials', 'quantity',
                'coupon_count', 'unit_price', 'agreed_rate', 'price_source', 'price_overridden', 'total_amount', 'payment_method',
                'payment_status', 'amount_paid', 'balance', 'staff', 'notes'];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `shepherd_locals_transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
});

// ------------------------------------------------------------------ STAFF ADMIN (manager)
$('#addStaffBtn').addEventListener('click', () => staffModal(null));
async function loadStaff() {
  $('#staffTable').innerHTML = '<tr><td class="muted">Loading…</td></tr>';
  try {
    const r = await api('listStaff'); if (!r.ok) throw fail(r);
    state.staff = r.staff;
    $('#staffTable').innerHTML = `<thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th>Last changed</th><th></th></tr></thead><tbody>` +
      r.staff.map((s) => `<tr${s.active ? '' : ' style="opacity:.55"'}><td><b>${esc(s.name)}</b>${s.name.toLowerCase() === state.user.name.toLowerCase() ? ' <span class="chip">you</span>' : ''}${s.owner ? ' <span class="chip warn">Owner 🔒</span>' : ''}</td>
        <td><span class="chip ${s.role === 'Manager' ? 'warn' : ''}">${esc(s.role)}</span></td>
        <td>${s.active ? '<span class="chip ok">Active</span>' : '<span class="chip bad">Deactivated</span>'}</td>
        <td class="small">${esc(when(s.last_login))}</td>
        <td class="small">${s.updated_at ? esc(when(s.updated_at)) + (s.updated_by ? '<div class="muted">by ' + esc(s.updated_by) + '</div>' : '') : '—'}</td>
        <td>${s.owner && s.name.toLowerCase() !== state.user.name.toLowerCase() ? '<span class="small muted">Protected</span>' : `<button class="btn quiet sm" data-staff="${esc(s.name)}">${s.owner ? 'Change PIN' : 'Edit'}</button>`}</td></tr>`).join('') + '</tbody>';
    $$('[data-staff]').forEach((b) => b.addEventListener('click', () => staffModal(state.staff.find((s) => s.name === b.dataset.staff))));
  } catch (err) { $('#staffTable').innerHTML = `<tr><td class="alert bad">${esc(err.message)}</td></tr>`; }
}
function staffModal(s) {
  const isSelf = s && s.name.toLowerCase() === state.user.name.toLowerCase();
  if (s && s.owner) return ownerPinModal(s);
  modal(`<h2>${s ? 'Edit ' + esc(s.name) : 'Add staff member'}</h2>
    <div class="field"><label>Name (what they type to log in)</label><input id="sfName" value="${esc(s?.name)}" autocomplete="off" maxlength="30"></div>
    <div class="field"><label>Role</label><div class="seg" id="sfRole"><button data-v="Front Desk">Front Desk</button><button data-v="Manager">Manager</button></div>
      ${isSelf ? '<p class="small muted">You can’t remove your own Manager role.</p>' : ''}</div>
    ${s ? `<div class="field"><label>Status</label><div class="seg" id="sfActive"><button data-v="true">Active</button><button data-v="false">Deactivated</button></div>
      ${isSelf ? '<p class="small muted">You can’t deactivate your own account.</p>' : ''}</div>` : ''}
    <div class="field"><label>${s ? 'New PIN (leave blank to keep the current one)' : 'PIN (4–8 digits)'}</label>
      <input id="sfPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
    <div class="field"><label>Repeat PIN</label><input id="sfPin2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
    <p class="small muted">Tell the person their PIN privately. It is stored only as a scrambled hash — nobody can look it up later; just set a new one.</p>
    <div id="sfMsg"></div>
    <div class="row"><button class="btn quiet" data-close>Cancel</button><button class="btn primary" id="sfSave">${s ? 'Save changes' : 'Create user'}</button></div>`, (m, close) => {
    let role = s?.role || 'Front Desk', active = s ? s.active : true;
    const seg = (id, val, set) => { $$(id + ' button', m).forEach((b) => { b.classList.toggle('on', b.dataset.v === String(val));
      b.onclick = () => { set(b.dataset.v); $$(id + ' button', m).forEach((x) => x.classList.toggle('on', x === b)); }; }); };
    seg('#sfRole', role, (v) => { role = v; });
    if (s) seg('#sfActive', active, (v) => { active = v === 'true'; });
    $('#sfSave', m).onclick = async (e) => {
      const name = $('#sfName', m).value.trim(), pin = $('#sfPin', m).value.trim(), pin2 = $('#sfPin2', m).value.trim();
      const msg = (t) => { $('#sfMsg', m).innerHTML = `<div class="alert bad">${esc(t)}</div>`; };
      if (!name) return msg('Enter a name.');
      if (!s && !pin) return msg('Set a PIN for the new user.');
      if (pin && !/^\d{4,8}$/.test(pin)) return msg('PIN must be 4 to 8 digits.');
      if (pin !== pin2) return msg('The two PINs do not match.');
      const renamed = s && name !== s.name;
      if (renamed && !pin) return msg('Changing the name also needs a new PIN.');
      const body = s ? { mode: 'update', name: s.name, role, active, ...(renamed ? { new_name: name } : {}), ...(pin ? { pin } : {}) }
                     : { mode: 'add', name, role, pin };
      busy(e.currentTarget, true, 'Saving…');
      try { const r = await api('saveStaff', body); if (!r.ok) throw fail(r);
        close(); toast(s ? 'Saved' : `${r.staff.name} created as ${r.staff.role}`); loadStaff();
        if (isSelf && renamed) { toast('You renamed yourself — please log in again.'); logout(false); }
      } catch (err) { msg(err.message); busy(e.currentTarget, false); }
    };
  });
}

function ownerPinModal(s) {
  modal(`<h2>Owner account — ${esc(s.name)} 🔒</h2>
    <p class="small muted">This account is protected: no one can delete, deactivate, demote or rename it, and other managers cannot change its PIN. You can change your own PIN here.</p>
    <div class="field"><label>New PIN (4–8 digits)</label><input id="opPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
    <div class="field"><label>Repeat new PIN</label><input id="opPin2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
    <div id="opMsg"></div>
    <div class="row"><button class="btn quiet" data-close>Cancel</button><button class="btn primary" id="opSave">Change PIN</button></div>`, (m, close) => {
    $('#opSave', m).onclick = async (e) => {
      const pin = $('#opPin', m).value.trim(), pin2 = $('#opPin2', m).value.trim();
      const msg = (t) => { $('#opMsg', m).innerHTML = `<div class="alert bad">${esc(t)}</div>`; };
      if (!/^\d{4,8}$/.test(pin)) return msg('PIN must be 4 to 8 digits.');
      if (pin !== pin2) return msg('The two PINs do not match.');
      busy(e.currentTarget, true, 'Saving…');
      try { const r = await api('saveStaff', { mode: 'update', name: s.name, pin }); if (!r.ok) throw fail(r); close(); toast('Your PIN has been changed'); loadStaff(); }
      catch (err) { msg(err.message); busy(e.currentTarget, false); }
    };
  });
}

// ------------------------------------------------------------------ installable app (PWA)
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!isStandalone()) $('#installBtn').classList.remove('hidden'); });
$('#installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {}
  installEvt = null; $('#installBtn').classList.add('hidden');
});
window.addEventListener('appinstalled', () => { $('#installBtn').classList.add('hidden'); toast('Installed — open Shepherd Coupons from your home screen.'); });
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  if (!isStandalone()) $('#iosHint').classList.remove('hidden');
}

// ------------------------------------------------------------------ boot
if (window.innerWidth < 700) $('#tab-log details.filters')?.removeAttribute('open');
if (!API || API.startsWith('PASTE_')) $('#configWarn').classList.remove('hidden');
if (state.token && state.user) api('me').then((r) => { if (r.ok) startApp(); }).catch(() => logout(true));
refreshSell();
