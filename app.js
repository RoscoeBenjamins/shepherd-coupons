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

const state = {
  token: sessionStorage.getItem('sl_token'), user: JSON.parse(sessionStorage.getItem('sl_user') || 'null'),
  customers: [], booklets: [], tx: [], txStaff: [],
  sell: { type: 'Full Booklet', items: [], method: null, status: null, priceTouched: false },
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
      <div class="row" style="margin-top:1rem"><button class="btn light" data-close id="cbNo">Cancel</button>
      <button class="btn ${okClass}" id="cbYes">${esc(okLabel)}</button></div>`, (m, close) => {
      $('#cbYes', m).onclick = () => { close(); resolve(true); };
      $('#cbNo', m).onclick = () => { close(); resolve(false); };
    });
  });
}

// ------------------------------------------------------------------ login / shell
const TABS = [
  { id: 'redeem', label: 'Redeem', roles: ['Front Desk', 'Manager'] },
  { id: 'sell', label: 'Sell', roles: ['Front Desk', 'Manager'] },
  { id: 'dash', label: 'Dashboard', roles: ['Manager'] },
  { id: 'customers', label: 'Customers', roles: ['Manager'] },
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
    sessionStorage.setItem('sl_token', r.token); sessionStorage.setItem('sl_user', JSON.stringify(r.user));
    $('#loginPin').value = '';
    startApp();
  } catch (err) { $('#loginMsg').innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
  finally { busy(btn, false); }
});

$('#logoutBtn').addEventListener('click', () => logout(false));
function logout(expired) {
  if (!expired && state.token) api('logout').catch(() => {});
  stopAllScanners();
  state.token = null; state.user = null; sessionStorage.clear();
  $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden');
  if (expired) $('#loginMsg').innerHTML = '<div class="alert warn">Your session expired. Please log in again.</div>';
}

function startApp() {
  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#whoName').textContent = state.user.name; $('#whoRole').textContent = state.user.role;
  const tabs = TABS.filter((t) => t.roles.includes(state.user.role));
  $('#tabs').innerHTML = tabs.map((t) => `<button data-tab="${t.id}">${t.label}</button>`).join('');
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  loadCustomers(); loadBooklets();
  showTab('redeem');
}

function showTab(id) {
  stopAllScanners();
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
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
    if (btn) btn.textContent = '■ Stop camera';
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
  if (s.btn) s.btn.textContent = s.btn.id === 'redeemCamBtn' ? '📷 Start camera' : '📷 Scan';
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

const VERDICTS = {
  VALID: { cls: 'ok', icon: '✅', title: 'VALID' },
  REDEEMED: { cls: 'ok', icon: '✅', title: 'REDEEMED' },
  ALREADY_REDEEMED: { cls: 'bad', icon: '❌', title: 'ALREADY REDEEMED' },
  NOT_SOLD: { cls: 'bad', icon: '❌', title: 'NOT SOLD', msg: 'This coupon is still in stock — it was never sold. Do not accept it.' },
  VOID: { cls: 'bad', icon: '❌', title: 'VOID', msg: 'This coupon has been cancelled by the manager. Do not accept it.' },
  UNKNOWN: { cls: 'bad', icon: '❌', title: 'UNKNOWN SERIAL', msg: 'Not in the register. Do not accept it.' },
  INVALID: { cls: 'warn', icon: '⚠️', title: 'CHECK THE SERIAL', msg: 'This is not a valid Shepherd Locals serial. Re-scan or re-type it carefully.' },
  MAPS_QR: { cls: 'warn', icon: '↩️', title: 'WRONG SIDE', msg: 'That is the Google Maps QR on the back. Turn the coupon over and scan the QR code next to the serial number.' },
};

async function handleRedeemCode(raw) {
  pauseScanner('redeemScanner', true);
  const box = $('#redeemResult');
  box.innerHTML = '<div class="result"><span class="spinner" style="border-color:#ccc;border-top-color:var(--orange)"></span> Checking…</div>';
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
            <div style="margin-top:.4rem">Sold to <b>${esc(c.sold_to || '—')}</b></div>
            <div class="small">Booklet ${esc(c.booklet_serial)} · coupon ${esc(c.coupon_no)}</div>`;
    if (verdict === 'REDEEMED') meta += `<div class="small">Redeemed ${esc(when(c.redeemed_at))} by ${esc(c.redeemed_by)}</div>`;
  } else if (c && verdict === 'ALREADY_REDEEMED') {
    meta = `<div>Redeemed <b>${esc(when(c.redeemed_at))}</b></div><div>by <b>${esc(c.redeemed_by || '—')}</b></div>
            <div class="small">Sold to ${esc(c.sold_to || '—')} · ${esc(c.tier)}</div>`;
  } else {
    meta = `<div>${esc(v.msg || '')}</div>`;
  }
  const actions = verdict === 'VALID'
    ? `<div class="actions"><button class="btn light big" id="rdCancel">Cancel</button><button class="btn ok big" id="rdConfirm">Confirm redemption</button></div>`
    : `<button class="btn primary big" id="rdNext">Scan next coupon</button>`;
  $('#redeemResult').innerHTML = `<div class="result ${v.cls}"><div class="icon">${v.icon}</div><div class="title">${v.title}</div>
      <div class="serial">${esc(serial)}</div><div class="meta">${meta}</div>${actions}</div>`;
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
async function loadBooklets() {
  try { const r = await api('listBooklets'); if (r.ok) { state.booklets = r.booklets; renderBookletPick(); } } catch (e) {}
}
async function loadCustomers() {
  try { const r = await api('listCustomers'); if (r.ok) { state.customers = r.customers; renderCustomerSelect(); } } catch (e) {}
}

function cartTier() { return state.sell.items[0]?.tier || null; }

function renderBookletPick() {
  const s = state.sell, tier = cartTier();
  $('#bookletPick').innerHTML = state.booklets.map((b) => {
    const available = b.status === 'In Stock' && b.in_stock === COUPONS_PER_BOOKLET;
    const on = s.items.some((i) => i.booklet_serial === b.booklet_serial);
    const blocked = !available || (tier && tier !== b.tier && !on);
    const label = available ? 'In stock' : esc(b.status) + (b.sold_to ? ' · ' + esc(b.sold_to) : '');
    return `<button data-b="${esc(b.booklet_serial)}" class="${on ? 'on' : ''}" ${blocked ? 'disabled' : ''}>
      <b>${esc(b.booklet_serial)}</b><span class="chip ${esc(b.tier)}">${esc(b.tier)}</span> <span class="small muted">${label}</span></button>`;
  }).join('');
  $$('#bookletPick button').forEach((btn) => btn.addEventListener('click', () => toggleBooklet(btn.dataset.b)));
}

function toggleBooklet(id) {
  const s = state.sell;
  $('#saleResult').innerHTML = '';
  const i = s.items.findIndex((x) => x.booklet_serial === id);
  if (i >= 0) s.items.splice(i, 1);
  else {
    const b = state.booklets.find((x) => x.booklet_serial === id);
    if (!b) return sellMsg('bad', 'Unknown booklet ' + id);
    if (!(b.status === 'In Stock' && b.in_stock === COUPONS_PER_BOOKLET)) return sellMsg('bad', `${id} is not available (${b.status}). Sell its remaining coupons as singles.`);
    if (cartTier() && cartTier() !== b.tier) return sellMsg('bad', 'One sale = one tier. Finish this sale first.');
    s.items.push({ booklet_serial: id, tier: b.tier });
    sellMsg('ok', id + ' added.');
  }
  refreshSell();
}

$('#sellType').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v; if (!v || v === state.sell.type) return;
  if (state.sell.items.length && !window.confirm('Switching clears the items you have added. Continue?')) return;
  state.sell.type = v; state.sell.items = []; state.sell.priceTouched = false;
  $$('#sellType button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#bookletMode').classList.toggle('hidden', v !== 'Full Booklet');
  $('#singleMode').classList.toggle('hidden', v === 'Full Booklet');
  sellMsg(); refreshSell();
});
$('#sellCamBtn').addEventListener('click', (e) => startScanner('sellScanner', e.currentTarget, (t) => addToCart(t)));
$('#sellManual').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#sellSerial').value; if (v.trim()) addToCart(v); $('#sellSerial').value = ''; });

function sellMsg(kind, text) { $('#sellMsg').innerHTML = kind ? `<div class="alert ${kind}">${esc(text)}</div>` : ''; }

async function addToCart(raw) {
  const s = state.sell, code = normSerial(raw);
  $('#saleResult').innerHTML = '';
  if (/^HTTPS?:/.test(code)) return sellMsg('warn', 'That is the Maps QR on the back — scan the QR code on the front.');
  if (isBookletId(code)) {
    if (s.type !== 'Full Booklet') return sellMsg('warn', 'That is a booklet number. Switch to "Full booklet(s)" to sell a whole booklet.');
    if (s.items.some((i) => i.booklet_serial === code)) return sellMsg('warn', code + ' is already in this sale.');
    return toggleBooklet(code);
  }
  try {
    const r = await api('lookup', { serial: code });
    if (!r.ok) throw fail(r);
    const c = r.coupon;
    if (!c) return sellMsg('bad', r.verdict === 'INVALID' ? `${code} is not a valid serial — check it.` : `${code} is not in the register.`);
    if (s.type === 'Full Booklet') {
      if (s.items.some((i) => i.booklet_serial === c.booklet_serial)) return sellMsg('warn', c.booklet_serial + ' is already in this sale.');
      await loadBooklets();
      return toggleBooklet(c.booklet_serial);
    }
    if (c.status !== 'In Stock') return sellMsg('bad', `${code} cannot be sold — it is ${c.status}${c.sold_to ? ' (to ' + c.sold_to + ')' : ''}.`);
    if (s.items.some((i) => i.serial === c.serial)) return sellMsg('warn', code + ' is already in the cart.');
    if (cartTier() && cartTier() !== c.tier) return sellMsg('bad', 'One sale = one tier. This cart is ' + cartTier() + '.');
    s.items.push({ serial: c.serial, tier: c.tier, booklet_serial: c.booklet_serial, coupon_no: c.coupon_no });
    sellMsg('ok', `${c.serial} added (${c.tier}).`);
    refreshSell();
  } catch (err) { sellMsg('bad', err.message); }
}

function renderCart() {
  const s = state.sell;
  $('#cart').innerHTML = s.items.map((it, i) => `<li><span class="chip ${esc(it.tier)}">${esc(it.tier)}</span>
     <code>${esc(it.serial || it.booklet_serial)}</code>
     <span class="small muted">${it.serial ? 'booklet ' + esc(it.booklet_serial) : COUPONS_PER_BOOKLET + ' coupons'}</span>
     <button class="x" data-i="${i}" title="Remove">×</button></li>`).join('');
  $$('#cart .x').forEach((b) => b.addEventListener('click', () => { s.items.splice(Number(b.dataset.i), 1); refreshSell(); }));
  const n = s.items.length;
  $('#cartSummary').textContent = !n ? 'Nothing added yet.' : s.type === 'Full Booklet'
    ? `${n} booklet${n > 1 ? 's' : ''} = ${n * COUPONS_PER_BOOKLET} coupons`
    : `${n} coupon${n > 1 ? 's' : ''}`;
}

function renderCustomerSelect() {
  const sel = $('#custSelect'), cur = sel.value;
  sel.innerHTML = '<option value="">— choose customer —</option>' + state.customers.map((c) =>
    `<option value="${esc(c.customer_id)}">${esc(c.name)} (${esc(c.type)})</option>`).join('');
  if (cur) sel.value = cur;
  const fc = $('#fCust');
  if (fc) { const v = fc.value; fc.innerHTML = '<option value="">All</option>' + state.customers.map((c) => `<option value="${esc(c.customer_id)}">${esc(c.name)}</option>`).join(''); fc.value = v; }
}
$('#custSelect').addEventListener('change', () => { state.sell.priceTouched = false; refreshSell(); });
$('#newCustBtn').addEventListener('click', () => customerModal(null, (c) => { $('#custSelect').value = c.customer_id; state.sell.priceTouched = false; refreshSell(); }));

function agreedRate() {
  const c = state.customers.find((x) => x.customer_id === $('#custSelect').value), tier = cartTier();
  if (!c || !tier) return { cust: c, rate: null };
  const key = tier.toLowerCase() + (state.sell.type === 'Full Booklet' ? '_booklet_rate' : '_single_rate');
  return { cust: c, rate: c[key] ?? null };
}
function qty() { return state.sell.items.length; }

function refreshSell() {
  renderCart(); renderBookletPick();
  const { cust, rate } = agreedRate();
  const per = state.sell.type === 'Full Booklet' ? 'per booklet' : 'per coupon';
  $('#unitPriceLabel').textContent = `Price ${per} (GHS)`;
  const priceEl = $('#unitPrice');
  if (!state.sell.priceTouched) priceEl.value = rate !== null ? rate : '';
  if (!cust || !qty()) $('#rateHint').textContent = 'Select a customer and add items first.';
  else if (rate !== null) $('#rateHint').innerHTML = `Agreed rate for <b>${esc(cust.name)}</b>: <b>${money(rate)}</b> ${per} (${esc(cartTier())}). You can change it — changes are flagged.`;
  else $('#rateHint').innerHTML = `<b>${esc(cust.name)}</b> has no agreed ${esc(cartTier())} rate ${per}. <b>Type the price agreed for this sale.</b>`;
  updateTotal();
}
function updateTotal() {
  const p = Number($('#unitPrice').value), { rate } = agreedRate();
  $('#saleTotal').textContent = money(p > 0 ? Math.round(p * qty() * 100) / 100 : 0);
  $('#overrideWarn').classList.toggle('hidden', !(rate !== null && $('#unitPrice').value !== '' && Math.abs(p - rate) >= 0.005));
}
$('#unitPrice').addEventListener('input', () => { state.sell.priceTouched = true; updateTotal(); });

function segPick(id, key) {
  $(id).addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    state.sell[key] = v; $$(id + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    if (key === 'status') $('#amountPaidWrap').classList.toggle('hidden', v !== 'Part-paid');
  });
}
segPick('#payMethod', 'method'); segPick('#payStatus', 'status');

$('#confirmSale').addEventListener('click', async (e) => {
  const s = state.sell, { cust, rate } = agreedRate();
  const price = Number($('#unitPrice').value), total = Math.round(price * qty() * 100) / 100;
  $('#saleResult').innerHTML = '';
  const problems = [];
  if (!qty()) problems.push('Add at least one ' + (s.type === 'Full Booklet' ? 'booklet' : 'coupon') + '.');
  if (!cust) problems.push('Select a customer.');
  if (!($('#unitPrice').value !== '' && price > 0)) problems.push('Enter the price.');
  if (!s.method) problems.push('Choose a payment method.');
  if (!s.status) problems.push('Choose a payment status.');
  const paid = Number($('#amountPaid').value);
  if (s.status === 'Part-paid' && !(paid > 0 && paid < total)) problems.push(`Enter the amount received (between 0 and ${total}).`);
  if (problems.length) { $('#saleResult').innerHTML = `<div class="alert bad">${problems.map(esc).join('<br>')}</div>`; return; }
  const override = rate !== null && Math.abs(price - rate) >= 0.005;
  const ok = await confirmBox('Confirm sale', `
    <p><b>${esc(cust.name)}</b> · <span class="chip ${esc(cartTier())}">${esc(cartTier())}</span></p>
    <p>${s.type === 'Full Booklet' ? qty() + ' booklet(s): ' + s.items.map((i) => esc(i.booklet_serial)).join(', ') : qty() + ' single coupon(s)'}</p>
    <p>${money(price)} × ${qty()} = <b>${money(total)}</b></p>
    <p>${esc(s.method)} · ${esc(s.status)}${s.status === 'Part-paid' ? ' (' + money(paid) + ' received)' : ''}</p>
    ${override ? `<div class="alert warn">Override: agreed rate is ${money(rate)}.</div>` : ''}`, 'Confirm sale');
  if (!ok) return;
  const btn = e.currentTarget; busy(btn, true, 'Saving sale…');
  try {
    const r = await api('sell', {
      sale_type: s.type, customer_id: cust.customer_id, unit_price: price,
      booklets: s.type === 'Full Booklet' ? s.items.map((i) => i.booklet_serial) : [],
      serials: s.type === 'Single Coupons' ? s.items.map((i) => i.serial) : [],
      payment_method: s.method, payment_status: s.status, amount_paid: paid || 0, notes: $('#saleNotes').value,
    });
    if (!r.ok) throw fail(r);
    const x = r.sale;
    $('#saleResult').innerHTML = `<div class="alert ok">✅ Sale <b>${esc(x.sale_id)}</b> saved — ${x.coupon_count} ${esc(x.tier)} coupons to ${esc(x.buyer_name)}, ${money(x.total_amount)} (${esc(x.payment_status)}).
      ${x.price_overridden ? '<br>Price override recorded.' : ''}</div>`;
    s.items = []; s.priceTouched = false; $('#saleNotes').value = ''; $('#amountPaid').value = '';
    sellMsg(); await loadBooklets(); refreshSell();
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
    <div class="row"><button class="btn light" data-close>Cancel</button><button class="btn primary" id="cmSave">Save</button></div>`, (m, close) => {
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
      <td><button class="btn light sm" data-edit="${esc(c.customer_id)}">Edit</button></td></tr>`).join('') ||
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
    const tierCard = (k) => { const x = t[k]; return `<div class="card"><h3><span class="chip ${k}">${k}</span></h3>
      <div class="kpis">
        <div class="kpi ${k}"><div class="v num">${x.sold_ever}</div><div class="l">Sold</div></div>
        <div class="kpi ${k}"><div class="v num">${x.redeemed}</div><div class="l">Redeemed</div></div>
        <div class="kpi ${k}"><div class="v num">${x.outstanding}</div><div class="l">Outstanding</div></div>
        <div class="kpi ${k}"><div class="v num">${x.in_stock}</div><div class="l">In stock</div></div>
      </div>
      <p class="small" style="margin:.7rem 0 0">Redemption rate <b>${x.redemption_rate}%</b>${x.void ? ` · ${x.void} void` : ''}</p>
      <div class="bar"><i style="width:${Math.min(100, x.redemption_rate)}%"></i></div>
      <p class="small" style="margin:.7rem 0 0">Revenue <b>${money(x.revenue)}</b> · paid ${money(x.paid)} · outstanding ${money(x.balance)}</p></div>`; };
    const kv = (obj) => Object.keys(obj).length ? Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r num">${money(v)}</td></tr>`).join('') : '<tr><td class="muted">No sales yet</td><td></td></tr>';
    body.innerHTML = `
      <div class="kpis" style="margin-bottom:1rem">
        <div class="kpi accent"><div class="v num">${money(d.totals.revenue)}</div><div class="l">Total billed</div></div>
        <div class="kpi accent"><div class="v num">${money(d.totals.paid)}</div><div class="l">Received</div></div>
        <div class="kpi accent"><div class="v num">${money(d.totals.balance)}</div><div class="l">Owed to us</div></div>
      </div>
      <div class="grid2">${tierCard('GOLD')}${tierCard('SILVER')}</div>
      <div class="grid2">
        <div class="card"><h3>Revenue by payment method</h3><table>${kv(d.by_method)}</table></div>
        <div class="card"><h3>Revenue by payment status</h3><table>${kv(d.by_payment_status)}</table></div>
      </div>
      <div class="card"><h3>Daily patronage — redemptions per day (last 30 days)</h3>${dailyChart(d.daily)}</div>
      <div class="card"><h3>Per company</h3><div class="tablewrap"><table><thead><tr><th>Customer</th><th class="r">Bought</th><th class="r">Redeemed</th>
        <th class="r">Outstanding</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Owes</th><th class="r">Avg / coupon</th></tr></thead><tbody>
        ${d.companies.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${c.gold ? c.gold + ' Gold ' : ''}${c.silver ? c.silver + ' Silver' : ''}</div></td>
          <td class="r num">${c.bought}</td><td class="r num">${c.redeemed} <span class="small muted">(${c.redemption_rate}%)</span></td>
          <td class="r num">${c.outstanding}</td><td class="r num">${money(c.billed)}</td><td class="r num">${money(c.paid)}</td>
          <td class="r num">${c.balance > 0 ? `<b style="color:var(--bad)">${money(c.balance)}</b>` : money(0)}</td><td class="r num">${money(c.avg_price)}</td></tr>`).join('')
          || '<tr><td colspan="8" class="muted">No sales yet.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">Updated ${esc(when(d.generated_at))}</p>`;
  } catch (err) { body.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
}

function dailyChart(days) {
  const W = 720, H = 220, P = { l: 30, r: 8, t: 10, b: 28 };
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
    if (i % 5 === 0 || i === days.length - 1) s += `<text x="${x + w / 2}" y="${H - 9}" font-size="11" text-anchor="middle" fill="#6B7280">${d.date.slice(5)}</text>`;
  });
  return s + `</svg><div class="legend"><span><i style="background:#D89A10"></i>Gold</span><span><i style="background:#8C96A3"></i>Silver</span></div>`;
}

// ------------------------------------------------------------------ BOOKLETS (manager)
async function renderBookletList() {
  await loadBooklets();
  $('#bookletList').innerHTML = state.booklets.map((b) => `<button data-b="${esc(b.booklet_serial)}"><b>${esc(b.booklet_serial)}</b>
    <span class="chip ${esc(b.tier)}">${esc(b.tier)}</span> <span class="small muted">${esc(b.status)}${b.sold_to ? ' · ' + esc(b.sold_to) : ''} · ${b.in_stock}/45 in stock</span></button>`).join('');
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
    <div class="row" style="margin-top:.8rem"><button class="btn light" data-close>Close</button>${canVoid ? '<button class="btn bad" id="voidBtn">Void coupon</button>' : ''}</div>`, (m, close) => {
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
    if (f.q && !(String(t.serials || '') + ' ' + String(t.sale_id || '') + ' ' + String(t.booklets || '')).toUpperCase().includes(f.q)) return false;
    return true;
  });
}
function renderLog() {
  const rows = filteredTx();
  const sales = rows.filter((t) => t.kind === 'Sale');
  const billed = sales.reduce((a, t) => a + Number(t.total_amount || 0), 0);
  $('#logCount').innerHTML = `${rows.length} entries · ${sales.length} sales (${money(billed)}) · ${rows.length - sales.length} redemptions`;
  $('#logTable').innerHTML = `<thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Tier</th><th>Details</th><th class="r">Qty</th>
    <th class="r">Unit price</th><th class="r">Total</th><th>Payment</th><th>Price</th><th>Staff</th></tr></thead><tbody>` +
    (rows.map((t) => t.kind === 'Sale'
      ? `<tr class="${t.price_overridden ? 'override' : ''}"><td class="small">${esc(when(t.timestamp))}<div class="muted">${esc(t.sale_id)}</div></td>
          <td><span class="chip">Sale</span></td><td>${esc(t.customer)}</td><td><span class="chip ${esc(t.tier)}">${esc(t.tier)}</span></td>
          <td class="small">${esc(t.sale_type)}${t.booklets ? ': ' + esc(t.booklets) : ''}<div class="muted">${t.coupon_count} coupons</div></td>
          <td class="r num">${esc(t.quantity)}</td><td class="r num">${money(t.unit_price)}</td><td class="r num"><b>${money(t.total_amount)}</b></td>
          <td class="small">${esc(t.payment_method)}<br><span class="chip ${t.payment_status === 'Paid' ? 'ok' : t.payment_status === 'Unpaid' ? 'bad' : 'warn'}">${esc(t.payment_status)}</span>
            ${Number(t.balance) > 0 ? `<div>owes ${money(t.balance)}</div><button class="btn light sm" data-pay="${esc(t.sale_id)}">Record payment</button>` : ''}</td>
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
    <div id="pmMsg"></div><div class="row"><button class="btn light" data-close>Cancel</button><button class="btn primary" id="pmSave">Save</button></div>`, (m, close) => {
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
  const cols = ['kind', 'timestamp', 'sale_id', 'customer_id', 'customer', 'buyer_type', 'tier', 'sale_type', 'booklets', 'serials', 'quantity',
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
      r.staff.map((s) => `<tr${s.active ? '' : ' style="opacity:.55"'}><td><b>${esc(s.name)}</b>${s.name.toLowerCase() === state.user.name.toLowerCase() ? ' <span class="chip">you</span>' : ''}</td>
        <td><span class="chip ${s.role === 'Manager' ? 'warn' : ''}">${esc(s.role)}</span></td>
        <td>${s.active ? '<span class="chip ok">Active</span>' : '<span class="chip bad">Deactivated</span>'}</td>
        <td class="small">${esc(when(s.last_login))}</td>
        <td class="small">${s.updated_at ? esc(when(s.updated_at)) + (s.updated_by ? '<div class="muted">by ' + esc(s.updated_by) + '</div>' : '') : '—'}</td>
        <td><button class="btn light sm" data-staff="${esc(s.name)}">Edit</button></td></tr>`).join('') + '</tbody>';
    $$('[data-staff]').forEach((b) => b.addEventListener('click', () => staffModal(state.staff.find((s) => s.name === b.dataset.staff))));
  } catch (err) { $('#staffTable').innerHTML = `<tr><td class="alert bad">${esc(err.message)}</td></tr>`; }
}
function staffModal(s) {
  const isSelf = s && s.name.toLowerCase() === state.user.name.toLowerCase();
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
    <div class="row"><button class="btn light" data-close>Cancel</button><button class="btn primary" id="sfSave">${s ? 'Save changes' : 'Create user'}</button></div>`, (m, close) => {
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

// ------------------------------------------------------------------ boot
if (!API || API.startsWith('PASTE_')) $('#configWarn').classList.remove('hidden');
if (state.token && state.user) api('me').then((r) => { if (r.ok) startApp(); }).catch(() => logout(true));
refreshSell();
