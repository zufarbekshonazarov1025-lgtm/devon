// ---------- Pullar: shaxsiy hamyon ----------
// Ma'lumotni faqat egasi ko'radi (bazadagi RLS). Bildirishnoma, umumiy statistika va hisobotlarga tushmaydi.
import { sb, S, bus, h, icon, toast, today, iso, fmtDate, go, Head, BackHead, Empty, addDays, monthStart, monthEnd, monthName, confirmBox } from './core.js';
import { buildXlsx } from './more.js';

/** Bo'lim kimga ochiq: hozircha faqat yordamchiga. */
export const moneyAllowed = () => S.me?.kind === 'yordamchi';

const M = { loaded: false, failed: false, loading: null, accounts: [], cats: [], tx: [], debts: [], devs: [], set: null, debtDir: 'men', month: monthStart(today()), acc: null, unlocked: false, catKind: 'chiqim' };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') M.unlocked = false; });

const DEF_ACC = [['Naqd pul', 'naqd'], ['Karta', 'karta']];
const DEF_CAT = {
  chiqim: [['🛒', 'Oziq-ovqat'], ['🚕', 'Transport'], ['🏠', 'Uy va kommunal'], ['📱', 'Aloqa va internet'], ['☕', 'Kafe va tushlik'], ['👕', 'Kiyim'], ['💊', 'Sog\'liq'], ['🎁', 'Sovg\'a va xayriya'], ['📚', 'O\'qish'], ['🎉', 'Dam olish'], ['📦', 'Boshqa']],
  kirim: [['💼', 'Oylik'], ['➕', 'Qo\'shimcha daromad'], ['🎁', 'Sovg\'a'], ['📦', 'Boshqa']],
};
const KIND_ACC = { naqd: 'Naqd', karta: 'Karta', jamgarma: 'Jamg\'arma' };
const KIND_TX = { chiqim: 'Chiqim', kirim: 'Kirim', otkazma: 'O\'tkazma' };
const OY_QISQA = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];

// ---------- Ma'lumot ----------
export async function loadMoney(force = false) {
  if (M.loaded && !force) return;
  if (M.loading) return M.loading;
  M.loading = (async () => {
    const [a, c, t, s, d, e] = await Promise.all([
      sb.from('fin_accounts').select('*').order('sort').order('created_at'),
      sb.from('fin_categories').select('*').order('sort').order('created_at'),
      sb.from('fin_tx').select('*').order('tx_date', { ascending: false }).order('created_at', { ascending: false }).limit(20000),
      sb.from('fin_settings').select('*').maybeSingle(),
      sb.from('fin_debts').select('*').order('created_at'),
      sb.from('fin_debt_events').select('*').order('event_date').order('created_at'),
    ]);
    if (a.error || c.error || t.error) { M.failed = true; return; }
    M.failed = false;
    M.accounts = a.data || []; M.cats = c.data || []; M.tx = t.data || []; M.set = s.data || null;
    M.debts = d.error ? [] : d.data || []; M.devs = e.error ? [] : e.data || [];
    if (!M.accounts.length && !M.cats.length && !M.tx.length) await seed();
    M.loaded = true;
  })();
  try { await M.loading; } finally { M.loading = null; }
}
async function seed() {
  const [a, c] = await Promise.all([
    sb.from('fin_accounts').insert(DEF_ACC.map(([name, kind], i) => ({ name, kind, sort: i }))).select(),
    sb.from('fin_categories').insert([...DEF_CAT.chiqim.map(([emoji, name], i) => ({ emoji, name, kind: 'chiqim', sort: i })), ...DEF_CAT.kirim.map(([emoji, name], i) => ({ emoji, name, kind: 'kirim', sort: i }))]).select(),
  ]);
  if (!a.error) M.accounts = a.data || [];
  if (!c.error) M.cats = c.data || [];
}
const reload = async (msg) => { await loadMoney(true); if (msg) toast(msg); bus.render(); };

// ---------- Hisob-kitob ----------
const num = (v) => Number(v) || 0;
const accOf = (id) => M.accounts.find((a) => a.id === id);
const catOf = (id) => M.cats.find((c) => c.id === id);
const curOf = (accId) => accOf(accId)?.currency || 'UZS';
export function balance(acc) {
  let b = num(acc.opening_balance);
  for (const t of M.tx) {
    if (t.account_id === acc.id) b += t.kind === 'kirim' ? num(t.amount) : -num(t.amount);
    if (t.to_account_id === acc.id) b += num(t.to_amount ?? t.amount);
  }
  for (const e of M.devs) if (e.account_id === acc.id) b += evSign(e) * num(e.amount);
  return Math.round(b * 100) / 100;
}
// ---------- Qarz hisob-kitobi ----------
const debtOf = (id) => M.debts.find((d) => d.id === id);
/** Qarz harakati hisobdagi pulni oshiradimi (+1) yoki kamaytiradimi (−1). */
const evSign = (e) => ((debtOf(e.debt_id)?.direction === 'men') === (e.type === 'oshdi') ? 1 : -1);
const evsOf = (d) => M.devs.filter((e) => e.debt_id === d.id);
function debtNums(d) {
  let total = 0, paid = 0;
  for (const e of evsOf(d)) if (e.type === 'oshdi') total += num(e.amount); else paid += num(e.amount);
  return { total, paid, left: Math.round((total - paid) * 100) / 100 };
}
const isOverdue = (d) => !!d.due_date && d.due_date < today() && debtNums(d).left > 0;
function debtSums(dir) {
  const r = { UZS: 0, USD: 0, n: 0, late: 0 };
  for (const d of M.debts) { if (d.direction !== dir) continue; const l = debtNums(d).left; if (l <= 0) continue; r[d.currency] += l; r.n++; if (isOverdue(d)) r.late++; }
  return r;
}

/** Davr bo'yicha kirim va chiqim (o'tkazmalar hisobga olinmaydi), valyuta bo'yicha alohida. */
function totals(a, b, accId = null) {
  const r = { UZS: { kirim: 0, chiqim: 0 }, USD: { kirim: 0, chiqim: 0 } };
  for (const t of M.tx) {
    if (t.kind === 'otkazma' || t.tx_date < a || t.tx_date > b) continue;
    if (accId && t.account_id !== accId) continue;
    r[curOf(t.account_id)][t.kind] += num(t.amount);
  }
  return r;
}

// ---------- Ko'rinish ----------
const hidden = () => !!M.set?.hide_amounts;
const group = (n) => { const [i, d] = Math.abs(n).toFixed(2).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d !== '00' ? ',' + d : ''); };
export function money(n, cur = 'UZS', sign = '') {
  if (hidden()) return '••••';
  const s = n < 0 ? '−' : sign;
  return cur === 'USD' ? `${s}$${group(n)}` : `${s}${group(n)} so'm`;
}
function short(n, cur = 'UZS') {
  if (hidden()) return '••••';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (cur === 'USD') return `${s}$${a >= 10000 ? Math.round(a / 1000) + 'k' : group(Math.round(a))}`;
  const f = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
  if (a >= 1e9) return `${s}${f(a / 1e9)} mlrd`;
  if (a >= 1e6) return `${s}${f(a / 1e6)} mln`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)} ming`;
  return s + group(a);
}
const parseAmount = (s) => { const v = Number(String(s).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
function amountInput(id, value) {
  const el = h('input', { class: 'input money-in', id, inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: value ? group(value).replace(',00', '') : '' });
  el.addEventListener('input', () => {
    const pos = el.value.length - el.selectionStart;
    let raw = el.value.replace(/[^\d,.]/g, '').replace('.', ',');
    const [i, ...d] = raw.split(','); raw = i.replace(/^0+(?=\d)/, '') + (d.length ? ',' + d.join('').slice(0, 2) : '');
    const [ii, dd] = raw.split(',');
    el.value = ii.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (dd !== undefined ? ',' + dd : '');
    const p = Math.max(0, el.value.length - pos); el.setSelectionRange(p, p);
  });
  return el;
}
const WALLET = '<path d="M3 7a2 2 0 0 1 2-2h12v4"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14" r="1.3" fill="currentColor"/>';
const EYE = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6C3.8 9.3 2 12 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4.3-1"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>';
const GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>';
const svg = (p, size = 20) => h('span', { 'aria-hidden': 'true', style: 'display:inline-flex', html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` });
export const walletIcon = (size = 22) => svg(WALLET, size);

function sheet(title, body, onClose) {
  const close = () => { ov.remove(); onClose?.(); };
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), body(close)));
  document.body.append(ov);
  return close;
}

// ---------- PIN ----------
async function pinHash(pin) {
  const data = new TextEncoder().encode(`devon-pullar:${S.me.id}:${pin}`);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function saveSettings(patch) {
  const row = { owner_id: S.me.id, pin_hash: M.set?.pin_hash ?? null, hide_amounts: !!M.set?.hide_amounts, ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from('fin_settings').upsert(row).select().single();
  if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return false; }
  M.set = data; return true;
}
function Lock() {
  const pin = h('input', { class: 'input pin-in', id: 'm_pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, 'aria-label': 'PIN-kod' });
  const err = h('div', { class: 'err' });
  const open = async () => {
    if (await pinHash(pin.value) === M.set.pin_hash) { M.unlocked = true; bus.render(); return; }
    err.textContent = 'PIN-kod noto\'g\'ri'; pin.value = ''; pin.focus();
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  setTimeout(() => pin.focus(), 50);
  return h('main', { class: 'view' },
    Head('Shaxsiy', 'Pullar'),
    h('section', { class: 'card lockcard' },
      h('span', { class: 'lockico' }, walletIcon(30)),
      h('b', {}, 'PIN-kodni kiriting'),
      pin, err,
      h('button', { class: 'btn', type: 'button', onclick: open }, 'Ochish'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: forgotPin }, 'PIN-kodni unutdim')));
}
function forgotPin() {
  sheet('PIN-kodni o\'chirish', (close) => {
    const pw = h('input', { class: 'input', id: 'm_pw', type: 'password', autocomplete: 'current-password' });
    const err = h('div', { class: 'err' });
    return [h('p', { class: 't-meta' }, 'Devon\'ga kirish parolingizni kiriting. Parol to\'g\'ri bo\'lsa, PIN-kod o\'chadi va yangisini qo\'yishingiz mumkin.'),
      h('div', { class: 'field' }, h('label', { for: 'm_pw' }, 'Parol'), pw), err,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const email = S.session?.user?.email;
          if (!email || !pw.value) { err.textContent = 'Parolni kiriting'; return; }
          const { error } = await sb.auth.signInWithPassword({ email, password: pw.value });
          if (error) { err.textContent = 'Parol noto\'g\'ri'; return; }
          if (await saveSettings({ pin_hash: null })) { M.unlocked = true; close(); toast('PIN-kod o\'chirildi'); bus.render(); }
        } }, 'O\'chirish'))];
  });
}
function pinSheet() {
  sheet(M.set?.pin_hash ? 'PIN-kodni almashtirish' : 'PIN-kod qo\'yish', (close) => {
    const a = h('input', { class: 'input pin-in', id: 'm_p1', type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off' });
    const b = h('input', { class: 'input pin-in', id: 'm_p2', type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off' });
    const err = h('div', { class: 'err' });
    setTimeout(() => a.focus(), 50);
    return [h('p', { class: 't-meta' }, '4–8 ta raqam. Har safar «Pullar»ni ochganda so\'raladi. Dasturdan chiqib qaytganda yana so\'raladi.'),
      h('div', { class: 'field' }, h('label', { for: 'm_p1' }, 'Yangi PIN-kod'), a),
      h('div', { class: 'field' }, h('label', { for: 'm_p2' }, 'Yana bir marta'), b), err,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!/^\d{4,8}$/.test(a.value)) { err.textContent = 'Faqat raqam, 4 tadan 8 tagacha'; return; }
          if (a.value !== b.value) { err.textContent = 'Ikkalasi bir xil emas'; return; }
          if (await saveSettings({ pin_hash: await pinHash(a.value) })) { M.unlocked = true; close(); toast('PIN-kod qo\'yildi'); bus.render(); }
        } }, 'Saqlash'))];
  });
}

// ---------- Yozuv qo'shish / tahrirlash ----------
export function txSheet(tx = null, kind0 = 'chiqim') {
  let kind = tx?.kind || kind0;
  const accs = M.accounts.filter((a) => !a.archived || a.id === tx?.account_id || a.id === tx?.to_account_id);
  if (!accs.length) { toast('Avval hisob qo\'shing'); go('#/pullar/sozlama'); return; }
  let cat = tx?.category_id || null;
  const lastAcc = (() => { try { return localStorage.getItem('devon_m_acc'); } catch (e) { return null; } })();
  const amt = amountInput('m_amt', tx ? num(tx.amount) : null);
  const amt2 = amountInput('m_amt2', tx?.to_amount ? num(tx.to_amount) : null);
  const accSel = h('select', { class: 'input', id: 'm_acc' }, accs.map((a) => h('option', { value: a.id }, `${a.name} · ${a.currency === 'USD' ? '$' : 'so\'m'}`)));
  accSel.value = tx?.account_id || (accs.some((a) => a.id === lastAcc) ? lastAcc : accs[0].id);
  const toSel = h('select', { class: 'input', id: 'm_to' }, accs.map((a) => h('option', { value: a.id }, `${a.name} · ${a.currency === 'USD' ? '$' : 'so\'m'}`)));
  toSel.value = tx?.to_account_id || (accs.find((a) => a.id !== accSel.value) || accs[0]).id;
  const date = h('input', { class: 'input', id: 'm_date', type: 'date', value: tx?.tx_date || today(), max: addDays(today(), 366) });
  const note = h('input', { class: 'input', id: 'm_note', maxlength: 300, placeholder: 'Masalan: Korzinka, bozorlik', value: tx?.note || '' });
  const err = h('div', { class: 'err' });
  const segBox = h('div', { class: 'seg' }), catBox = h('div', {}), toBox = h('div', { class: 'field' }), amt2Box = h('div', { class: 'field' });
  const curLabel = h('span', { class: 't-meta' }), accLabel = h('label', { for: 'm_acc' });

  const paint = () => {
    segBox.replaceChildren(...Object.entries(KIND_TX).map(([k, label]) => h('button', { type: 'button', class: (kind === k ? 'on ' : '') + 'k-' + k, 'aria-pressed': String(kind === k), onclick: () => { if (kind !== k) { kind = k; if (catOf(cat)?.kind !== k) cat = null; paint(); } } }, label)));
    const cats = M.cats.filter((c) => c.kind === kind && (!c.archived || c.id === cat));
    catBox.replaceChildren(...(kind === 'otkazma' ? [] : [h('div', { class: 'field' }, h('label', {}, 'Toifa'),
      h('div', { class: 'catgrid', role: 'group', 'aria-label': 'Toifa' }, cats.map((c) => h('button', { type: 'button', class: 'catbtn' + (cat === c.id ? ' on' : ''), 'aria-pressed': String(cat === c.id), onclick: () => { cat = c.id; paint(); } },
        h('i', { 'aria-hidden': 'true' }, c.emoji || '•'), h('span', {}, c.name)))))]));
    toBox.style.display = kind === 'otkazma' ? '' : 'none';
    const cross = kind === 'otkazma' && curOf(accSel.value) !== curOf(toSel.value);
    amt2Box.style.display = cross ? '' : 'none';
    curLabel.textContent = curOf(accSel.value) === 'USD' ? 'dollarda' : 'so\'mda';
    accLabel.textContent = kind === 'otkazma' ? 'Qaysi hisobdan' : 'Hisob';
  };
  accSel.addEventListener('change', paint); toSel.addEventListener('change', paint);
  toBox.append(h('label', { for: 'm_to' }, 'Qaysi hisobga'), toSel);
  amt2Box.append(h('label', { for: 'm_amt2' }, 'Tushgan summa (u hisob valyutasida)'), amt2);
  paint();
  setTimeout(() => { if (!tx) amt.focus(); }, 80);

  sheet(tx ? 'Yozuvni tahrirlash' : 'Yangi yozuv', (close) => [
    segBox,
    h('div', { class: 'field' }, h('label', { for: 'm_amt', class: 'between' }, h('span', {}, 'Summa'), curLabel), amt),
    catBox,
    h('div', { class: 'field' }, accLabel, accSel),
    toBox, amt2Box,
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1' }, h('label', { for: 'm_date' }, 'Sana'), date)),
    h('div', { class: 'field' }, h('label', { for: 'm_note' }, 'Izoh (ixtiyoriy)'), note),
    err,
    h('div', { class: 'row' },
      tx ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!await confirmBox({ title: 'Yozuv o\'chirilsinmi?', text: 'Qaytarib bo\'lmaydi.', ok: 'O\'chirish', danger: true })) return;
        const { error } = await sb.from('fin_tx').delete().eq('id', tx.id);
        if (error) { toast('O\'chirib bo\'lmadi'); return; }
        close(); reload('O\'chirildi');
      } }, 'O\'chirish') : h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        const v = parseAmount(amt.value);
        if (!(v > 0)) { err.textContent = 'Summani kiriting'; amt.focus(); return; }
        if (kind !== 'otkazma' && !cat) { err.textContent = 'Toifani tanlang'; return; }
        if (kind === 'otkazma' && toSel.value === accSel.value) { err.textContent = 'Ikki xil hisobni tanlang'; return; }
        const cross = kind === 'otkazma' && curOf(accSel.value) !== curOf(toSel.value);
        const v2 = cross ? parseAmount(amt2.value) : null;
        if (cross && !(v2 > 0)) { err.textContent = 'Tushgan summani kiriting'; return; }
        if (!date.value) { err.textContent = 'Sanani tanlang'; return; }
        const row = { kind, amount: v, account_id: accSel.value, to_account_id: kind === 'otkazma' ? toSel.value : null, to_amount: v2, category_id: kind === 'otkazma' ? null : cat, note: note.value.trim() || null, tx_date: date.value };
        e.target.disabled = true;
        const { error } = tx ? await sb.from('fin_tx').update(row).eq('id', tx.id) : await sb.from('fin_tx').insert(row);
        e.target.disabled = false;
        if (error) { err.textContent = 'Saqlab bo\'lmadi: ' + error.message; return; }
        try { localStorage.setItem('devon_m_acc', accSel.value); } catch (x) { /* xotira yopiq */ }
        if (!tx) M.month = monthStart(date.value);
        close(); reload(tx ? 'Saqlandi' : 'Qo\'shildi');
      } }, 'Saqlash')),
  ]);
}

/** Yuklanayotganda yoki yuklab bo'lmaganda (qayta urinish tugmasi bilan; o'zidan-o'zi takrorlanmaydi). */
function Loading(head) {
  if (M.failed) return h('main', { class: 'view' }, head, Empty('Ma\'lumotni yuklab bo\'lmadi', 'Internetni tekshiring.'),
    h('button', { class: 'btn', type: 'button', onclick: () => { M.failed = false; bus.render(); } }, 'Qayta urinish'));
  if (!M.loading) loadMoney().then(() => bus.render());
  return h('main', { class: 'view' }, head, h('div', { class: 't-meta', style: 'padding:0 4px' }, 'Yuklanmoqda…'));
}

// ---------- Asosiy ekran ----------
function TxRow(t) {
  const c = catOf(t.category_id), a = accOf(t.account_id), cur = curOf(t.account_id);
  const title = t.kind === 'otkazma' ? `${a?.name || '—'} → ${accOf(t.to_account_id)?.name || '—'}` : (c?.name || 'Toifasiz');
  const sub = [t.note, t.kind !== 'otkazma' && M.accounts.length > 1 ? a?.name : null].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'txrow', onclick: () => txSheet(t) },
    h('i', { class: 'txico ' + t.kind, 'aria-hidden': 'true' }, t.kind === 'otkazma' ? '⇄' : (c?.emoji || '•')),
    h('span', { class: 'txmid' }, h('b', {}, title), sub && h('small', {}, sub)),
    h('b', { class: 'txamt ' + t.kind }, money(num(t.amount), cur, t.kind === 'kirim' ? '+' : t.kind === 'chiqim' ? '−' : '')));
}

function MonthBar() {
  const shift = (n) => { const d = new Date(M.month + 'T12:00:00'); d.setMonth(d.getMonth() + n); M.month = monthStart(iso(d)); bus.render(); };
  const isNow = M.month === monthStart(today());
  return h('div', { class: 'monthbar' },
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Oldingi oy', onclick: () => shift(-1) }, icon('back', 20)),
    h('b', {}, monthName(M.month)),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Keyingi oy', disabled: isNow, onclick: () => shift(1) }, icon('next', 20)));
}

function WhereWent(a, b) {
  const rows = {};
  for (const t of M.tx) {
    if (t.kind !== 'chiqim' || t.tx_date < a || t.tx_date > b || curOf(t.account_id) !== 'UZS') continue;
    if (M.acc && t.account_id !== M.acc) continue;
    const k = t.category_id || '-'; rows[k] = (rows[k] || 0) + num(t.amount);
  }
  const list = Object.entries(rows).sort((x, y) => y[1] - x[1]);
  const limits = M.cats.filter((c) => c.kind === 'chiqim' && c.monthly_limit && !c.archived);
  for (const c of limits) if (!rows[c.id]) list.push([c.id, 0]);
  const sum = list.reduce((s, [, v]) => s + v, 0), max = Math.max(1, ...list.map(([, v]) => v));
  if (!sum && !limits.length) return [h('div', { class: 'section' }, h('h2', {}, 'Pul qayerga ketdi')), Empty('Bu oyda chiqim yo\'q', '«+» tugmasi bilan birinchi xarajatni yozing.')];
  return [h('div', { class: 'section' }, h('h2', {}, 'Pul qayerga ketdi'), h('span', { class: 't-meta' }, 'so\'mda')),
    h('section', { class: 'card', style: 'gap:12px' }, list.map(([id, v]) => {
      const c = catOf(id), lim = c?.monthly_limit ? num(c.monthly_limit) : null;
      const over = lim && v > lim, near = lim && !over && v >= lim * 0.8;
      return h('div', { class: 'mrow' },
        h('div', { class: 'between' },
          h('span', { class: 'mname' }, h('i', { 'aria-hidden': 'true' }, c?.emoji || '•'), c?.name || 'Toifasiz'),
          h('span', {}, h('b', {}, money(v)), sum ? h('small', { class: 't-meta' }, ` · ${Math.round((v / sum) * 100)}%`) : null)),
        h('div', { class: 'hbar' }, h('i', { class: over ? 'over' : near ? 'amber' : '', style: `width:${lim ? Math.min(100, Math.round((v / lim) * 100)) : v ? Math.max(3, Math.round((v / max) * 100)) : 0}%` })),
        lim && h('small', { class: over ? 'c-red' : 't-meta', style: 'font-weight:600' }, over ? `Limitdan ${money(v - lim)} oshdi (limit ${money(lim)})` : `Limit ${money(lim)} · qoldi ${money(lim - v)}`));
    }))];
}

function SixMonths() {
  const cols = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(M.month + 'T12:00:00'); d.setMonth(d.getMonth() - i);
    const m = monthStart(iso(d)), t = totals(m, monthEnd(m), M.acc).UZS;
    cols.push({ m, label: OY_QISQA[Number(m.slice(5, 7)) - 1], ...t });
  }
  const max = Math.max(1, ...cols.map((c) => Math.max(c.kirim, c.chiqim)));
  if (!cols.some((c) => c.kirim || c.chiqim)) return null;
  return [h('div', { class: 'section' }, h('h2', {}, 'Oylar bo\'yicha'), h('span', { class: 't-meta' }, 'oxirgi 6 oy, so\'mda')),
    h('section', { class: 'card' },
      h('div', { class: 'mchart', role: 'img', 'aria-label': hidden() ? 'Summalar yashirilgan' : cols.map((c) => `${c.label}: kirim ${short(c.kirim)}, chiqim ${short(c.chiqim)}`).join('; ') },
        cols.map((c) => h('button', { type: 'button', class: 'mcol' + (c.m === M.month ? ' now' : ''), 'aria-label': monthName(c.m), onclick: () => { M.month = c.m; bus.render(); } },
          h('small', {}, c.chiqim ? short(c.chiqim) : ''),
          h('div', { class: 'mbars' },
            h('i', { class: 'in', style: `height:${c.kirim ? Math.max(3, Math.round((c.kirim / max) * 100)) : 0}px` }),
            h('i', { class: 'out', style: `height:${c.chiqim ? Math.max(3, Math.round((c.chiqim / max) * 100)) : 0}px` })),
          h('span', {}, c.label)))),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'in' }), 'Kirim'), h('span', {}, h('i', { class: 'out' }), 'Chiqim')))];
}

export function Money() {
  if (!moneyAllowed()) { go('#/bugun'); return h('main', { class: 'view' }); }
  if (!M.loaded) return Loading(Head('Shaxsiy', 'Pullar'));
  if (M.set?.pin_hash && !M.unlocked) return Lock();
  const a = M.month, b = monthEnd(M.month);
  const T = totals(a, b, M.acc), u = T.UZS, usd = T.USD;
  const diff = u.kirim - u.chiqim;
  const live = M.accounts.filter((x) => !x.archived);
  const sumCur = (cur) => live.filter((x) => x.currency === cur).reduce((s, x) => s + balance(x), 0);
  const hasUsd = live.some((x) => x.currency === 'USD');
  const txs = M.tx.filter((t) => t.tx_date >= a && t.tx_date <= b && (!M.acc || t.account_id === M.acc || t.to_account_id === M.acc));
  const evs = M.devs.filter((e) => e.event_date >= a && e.event_date <= b && (!M.acc || e.account_id === M.acc));
  const days = {};
  for (const t of txs) (days[t.tx_date] = days[t.tx_date] || []).push(t);
  for (const e of evs) (days[e.event_date] = days[e.event_date] || []).push({ ...e, _ev: true });
  const dayTotal = (list) => list.filter((t) => t.kind === 'chiqim' && curOf(t.account_id) === 'UZS').reduce((s, t) => s + num(t.amount), 0);
  const eye = h('button', { class: 'iconbtn', type: 'button', 'aria-label': hidden() ? 'Summalarni ko\'rsatish' : 'Summalarni yashirish', 'aria-pressed': String(hidden()), onclick: async () => { if (await saveSettings({ hide_amounts: !hidden() })) bus.render(); } }, svg(hidden() ? EYE_OFF : EYE));

  return h('main', { class: 'view money' },
    Head('Shaxsiy · faqat sizga ko\'rinadi', 'Pullar', h('div', { style: 'display:flex;gap:8px' }, eye,
      h('a', { class: 'iconbtn', href: '#/pullar/sozlama', 'aria-label': 'Pullar sozlamalari' }, svg(GEAR)))),
    // Jami qoldiq va hisoblar
    h('section', { class: 'card balcard' },
      h('small', {}, M.acc ? accOf(M.acc)?.name : 'Jami qoldiq'),
      h('b', { class: 'balbig' }, M.acc ? money(balance(accOf(M.acc)), curOf(M.acc)) : money(sumCur('UZS'))),
      !M.acc && hasUsd && h('span', { class: 'balusd' }, '+ ' + money(sumCur('USD'), 'USD')),
      h('div', { class: 'accs filters' },
        live.length > 1 && h('button', { type: 'button', class: 'accchip' + (!M.acc ? ' on' : ''), onclick: () => { M.acc = null; bus.render(); } }, h('span', {}, 'Hammasi')),
        live.map((x) => h('button', { type: 'button', class: 'accchip' + (M.acc === x.id ? ' on' : ''), 'aria-pressed': String(M.acc === x.id), onclick: () => { M.acc = M.acc === x.id ? null : x.id; bus.render(); } },
          h('span', {}, x.name), h('b', {}, short(balance(x), x.currency)))))),
    !M.tx.length && live.every((x) => !num(x.opening_balance)) && h('a', { class: 'card starthint', href: '#/pullar/sozlama' },
      h('b', {}, 'Boshlash uchun bitta qadam'),
      h('span', { style: 'font-size:14px' }, 'Naqd pulingiz va kartangizda hozir qancha borligini kiriting — shunda qoldiq to\'g\'ri chiqadi. Bu yerni bosing.')),
    DebtCard(),
    MonthBar(),
    h('div', { class: 'tiles t3' },
      h('div', { class: 'tile', style: 'cursor:default' }, h('b', { class: 'c-brand' }, short(u.kirim)), h('span', {}, 'Kirim')),
      h('div', { class: 'tile', style: 'cursor:default' }, h('b', { class: 'c-red' }, short(u.chiqim)), h('span', {}, 'Chiqim')),
      h('div', { class: 'tile', style: 'cursor:default' }, h('b', { class: diff < 0 ? 'c-red' : '' }, (diff > 0 && !hidden() ? '+' : '') + short(diff)), h('span', {}, 'Farq'))),
    (usd.kirim || usd.chiqim) ? h('div', { class: 't-meta', style: 'padding:0 4px' }, `Dollarda: kirim ${money(usd.kirim, 'USD')}, chiqim ${money(usd.chiqim, 'USD')}`) : null,
    WhereWent(a, b),
    SixMonths(),
    h('div', { class: 'section' }, h('h2', {}, 'Yozuvlar'), txs.length + evs.length ? h('span', { class: 't-meta' }, `${txs.length + evs.length} ta`) : null),
    txs.length + evs.length ? Object.keys(days).sort().reverse().map((d) => [
      h('div', { class: 'between dayhead' }, h('span', {}, d === today() ? 'Bugun' : d === addDays(today(), -1) ? 'Kecha' : fmtDate(d)), dayTotal(days[d]) ? h('span', {}, money(dayTotal(days[d]), 'UZS', '−')) : null),
      h('div', { class: 'list' }, days[d].map((x) => (x._ev ? EvRow(x) : TxRow(x))))]) : Empty('Yozuv yo\'q', 'Bu oyda hali hech narsa yozilmagan.'),
    h('div', { class: 'fabs' },
      h('button', { class: 'fab2 in', type: 'button', 'aria-label': 'Kirim qo\'shish', onclick: () => txSheet(null, 'kirim') }, '+ Kirim'),
      h('button', { class: 'fab', type: 'button', 'aria-label': 'Chiqim qo\'shish', onclick: () => txSheet(null, 'chiqim') }, icon('plus', 26, '#fff', 2.5))));
}

// ---------- Qarzlar ----------
const DIR = { men: 'Men qarzdorman', menga: 'Menga qarzdor' };
const dueChip = (d) => {
  if (!d.due_date || debtNums(d).left <= 0) return null;
  const n = Math.round((Date.parse(d.due_date + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000);
  if (n < 0) return h('span', { class: 'chip red' }, `Muddati o'tdi · ${-n} kun`);
  if (n === 0) return h('span', { class: 'chip amber' }, 'Bugun qaytarish kerak');
  if (n <= 7) return h('span', { class: 'chip amber' }, `${n} kun qoldi`);
  return h('span', { class: 'chip grey' }, `Muddat: ${fmtDate(d.due_date)}`);
};
function DebtCard() {
  const men = debtSums('men'), menga = debtSums('menga');
  const line = (r) => [r.UZS || !r.USD ? money(r.UZS) : null, r.USD ? money(r.USD, 'USD') : null].filter(Boolean).join(' + ');
  if (!men.n && !menga.n) return h('a', { class: 'card debtcard', href: '#/pullar/qarzlar' },
    h('div', { class: 'between' }, h('b', {}, 'Qarzlar'), icon('next', 18)),
    h('span', { class: 't-meta' }, 'Qarz yo\'q. Kimgadir qarz bo\'lsangiz yoki kimdir sizga qarz bo\'lsa, shu yerda yozib boring.'));
  return h('a', { class: 'card debtcard', href: '#/pullar/qarzlar' },
    h('div', { class: 'between' }, h('b', {}, 'Qarzlar'), h('span', { style: 'display:flex;align-items:center;gap:6px' }, (men.late + menga.late) ? h('span', { class: 'chip red' }, `${men.late + menga.late} tasi muddatidan o'tgan`) : null, icon('next', 18))),
    h('div', { class: 'debt2' },
      h('div', {}, h('small', {}, `Men qarzdorman · ${men.n} ta`), h('b', { class: men.n ? 'c-red' : '' }, men.n ? line(men) : '0')),
      h('div', {}, h('small', {}, `Menga qarzdor · ${menga.n} ta`), h('b', { class: menga.n ? 'c-brand' : '' }, menga.n ? line(menga) : '0'))));
}
function EvRow(e) {
  const d = debtOf(e.debt_id); if (!d) return null;
  const sg = evSign(e), cur = d.currency;
  const what = d.direction === 'men' ? (e.type === 'oshdi' ? 'Qarz oldim' : 'Qarzni qaytardim') : (e.type === 'oshdi' ? 'Qarz berdim' : 'Qarz qaytdi');
  const sub = [d.person, e.note, e.account_id ? accOf(e.account_id)?.name : 'hisobga tegmagan'].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'txrow', onclick: () => go('#/pullar/qarz/' + d.id) },
    h('i', { class: 'txico qarz', 'aria-hidden': 'true' }, '🤝'),
    h('span', { class: 'txmid' }, h('b', {}, what), h('small', {}, sub)),
    h('b', { class: 'txamt ' + (e.account_id ? (sg > 0 ? 'kirim' : '') : 'otkazma') }, money(num(e.amount), cur, e.account_id ? (sg > 0 ? '+' : '−') : '')));
}
function DebtItem(d) {
  const n = debtNums(d), pct = n.total ? Math.min(100, Math.round((n.paid / n.total) * 100)) : 0;
  return h('a', { class: 'card debtitem' + (n.left <= 0 ? ' closed' : ''), href: '#/pullar/qarz/' + d.id },
    h('div', { class: 'between' }, h('b', { class: 'dperson' }, d.person), h('b', { class: n.left <= 0 ? 'c-muted' : d.direction === 'men' ? 'c-red' : 'c-brand', style: 'white-space:nowrap' }, n.left <= 0 ? 'Yopildi' : money(n.left, d.currency))),
    n.total ? h('div', { class: 'hbar' }, h('i', { style: `width:${pct}%` })) : null,
    h('div', { class: 'between t-meta' }, h('span', {}, n.left <= 0 ? `Jami: ${short(n.total, d.currency)}` : n.paid ? `Qaytarildi ${pct}% · jami ${short(n.total, d.currency)}` : `Jami: ${short(n.total, d.currency)}`), dueChip(d)));
}
export function Debts() {
  if (!moneyAllowed()) { go('#/bugun'); return h('main', { class: 'view' }); }
  if (!M.loaded) return Loading(BackHead('Qarzlar', '#/pullar'));
  if (M.set?.pin_hash && !M.unlocked) return Lock();
  const dir = M.debtDir, s = debtSums(dir);
  const mine = M.debts.filter((d) => d.direction === dir);
  const open = mine.filter((d) => debtNums(d).left > 0).sort((x, y) => (x.due_date || '9999').localeCompare(y.due_date || '9999') || debtNums(y).left - debtNums(x).left);
  const closed = mine.filter((d) => debtNums(d).left <= 0);
  return h('main', { class: 'view money' },
    BackHead('Qarzlar', '#/pullar'),
    h('div', { class: 'seg' }, Object.entries(DIR).map(([k, l]) => h('button', { type: 'button', class: (dir === k ? 'on ' : '') + (k === 'men' ? 'k-chiqim' : 'k-kirim'), 'aria-pressed': String(dir === k), onclick: () => { M.debtDir = k; bus.render(); } }, l))),
    h('section', { class: 'card', style: 'gap:2px' },
      h('small', { class: 't-meta' }, dir === 'men' ? 'Jami qaytarishim kerak' : 'Jami menga qaytishi kerak'),
      h('b', { class: dir === 'men' ? 'c-red' : 'c-brand', style: 'font-size:26px;letter-spacing:-.4px' }, money(s.UZS)),
      s.USD ? h('b', { class: dir === 'men' ? 'c-red' : 'c-brand', style: 'font-size:16px' }, '+ ' + money(s.USD, 'USD')) : null,
      h('span', { class: 't-meta' }, `${s.n} ta ochiq qarz${s.late ? ` · ${s.late} tasi muddatidan o'tgan` : ''}`)),
    open.length ? open.map(DebtItem) : Empty(dir === 'men' ? 'Hech kimga qarzingiz yo\'q' : 'Hech kim sizga qarzdor emas', 'Pastdagi «+ Qarz» tugmasi bilan qo\'shing.'),
    closed.length ? [h('div', { class: 'section' }, h('h2', {}, 'Yopilganlar'), h('span', { class: 't-meta' }, `${closed.length} ta`)), closed.map(DebtItem)] : null,
    h('div', { class: 'fabs' }, h('button', { class: 'fab2 wide2', type: 'button', onclick: () => debtSheet(null) }, '+ Qarz')));
}
export function DebtDetail(id) {
  if (!moneyAllowed()) { go('#/bugun'); return h('main', { class: 'view' }); }
  if (!M.loaded) return Loading(BackHead('Qarz', '#/pullar/qarzlar'));
  if (M.set?.pin_hash && !M.unlocked) return Lock();
  const d = debtOf(id);
  if (!d) return h('main', { class: 'view' }, BackHead('Qarz', '#/pullar/qarzlar'), Empty('Qarz topilmadi', 'U o\'chirilgan bo\'lishi mumkin.'));
  const n = debtNums(d), evs = evsOf(d).slice().sort((x, y) => y.event_date.localeCompare(x.event_date) || y.created_at.localeCompare(x.created_at));
  const pct = n.total ? Math.min(100, Math.round((n.paid / n.total) * 100)) : 0;
  const men = d.direction === 'men';
  return h('main', { class: 'view money' },
    BackHead(d.person, '#/pullar/qarzlar'),
    h('section', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'between' }, h('small', { class: 't-meta' }, men ? 'Men qarzdorman · qolgan' : 'Menga qarzdor · qolgan'), dueChip(d)),
      h('b', { class: n.left <= 0 ? '' : men ? 'c-red' : 'c-brand', style: 'font-size:28px;letter-spacing:-.5px' }, n.left <= 0 ? 'Yopildi' : money(n.left, d.currency)),
      h('div', { class: 'hbar' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'between t-meta' }, h('span', {}, `Jami: ${money(n.total, d.currency)}`), h('span', {}, `Qaytarildi: ${money(n.paid, d.currency)} · ${pct}%`)),
      d.note && h('div', { class: 't-meta', style: 'font-size:13px' }, d.note)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', disabled: n.left <= 0, onclick: () => eventSheet(d, 'kamaydi') }, men ? 'Qaytardim' : 'Qaytardi'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => eventSheet(d, 'oshdi') }, men ? 'Yana oldim' : 'Yana berdim')),
    h('div', { class: 'section' }, h('h2', {}, 'Tarix'), h('span', { class: 't-meta' }, `${evs.length} ta`)),
    h('div', { class: 'list' }, evs.map((e) => h('button', { type: 'button', class: 'txrow', onclick: () => eventSheet(d, e.type, e) },
      h('i', { class: 'txico ' + (e.type === 'oshdi' ? 'qarz' : 'kirim'), 'aria-hidden': 'true' }, e.type === 'oshdi' ? '＋' : '✓'),
      h('span', { class: 'txmid' }, h('b', {}, e.type === 'oshdi' ? (men ? 'Qarz oldim' : 'Qarz berdim') : (men ? 'Qaytardim' : 'Qaytardi')),
        h('small', {}, [fmtDate(e.event_date), e.account_id ? accOf(e.account_id)?.name : 'hisobga tegmagan', e.note].filter(Boolean).join(' · '))),
      h('b', { class: 'txamt' }, money(num(e.amount), d.currency, e.type === 'oshdi' ? '+' : '−'))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => debtSheet(d) }, 'Tahrirlash'),
      h('button', { class: 'btn danger small', type: 'button', onclick: async () => {
        if (!await confirmBox({ title: 'Qarz o\'chirilsinmi?', text: 'Butun tarixi bilan o\'chadi, hisoblardagi qoldiq ham shunga qarab qaytadi.', ok: 'O\'chirish', danger: true })) return;
        const { error } = await sb.from('fin_debts').delete().eq('id', d.id);
        if (error) { toast('O\'chirib bo\'lmadi'); return; }
        go('#/pullar/qarzlar'); reload('O\'chirildi');
      } }, 'O\'chirish')));
}
/** Hisob tanlash: qarz valyutasidagi hisoblar va «hisobga tegmasin». */
function accPicker(id, cur, value) {
  const list = M.accounts.filter((a) => a.currency === cur && (!a.archived || a.id === value));
  const sel = h('select', { class: 'input', id }, h('option', { value: '' }, 'Hisobga tegmasin'), list.map((a) => h('option', { value: a.id }, a.name)));
  sel.value = value ?? '';
  return sel;
}
function debtSheet(d = null) {
  let dir = d?.direction || M.debtDir, cur = d?.currency || 'UZS';
  sheet(d ? 'Qarzni tahrirlash' : 'Yangi qarz', (close) => {
    const dirBox = h('div', { class: 'seg' }), curBox = h('div', { class: 'seg' }), hint = h('small', { class: 't-meta' }), accLabel = h('label', { for: 'd_acc' }), whoLabel = h('label', { for: 'd_person' });
    const person = h('input', { class: 'input', id: 'd_person', maxlength: 80, value: d?.person || '', placeholder: 'Masalan: Akmal aka' });
    const amt = amountInput('d_amt', null);
    const date = h('input', { class: 'input', id: 'd_date', type: 'date', value: today() });
    const due = h('input', { class: 'input', id: 'd_due', type: 'date', value: d?.due_date || '' });
    const note = h('input', { class: 'input', id: 'd_note', maxlength: 300, value: d?.note || '', placeholder: 'Nima uchun, qanday kelishildi' });
    const accBox = h('div', { class: 'field' });
    const err = h('div', { class: 'err' });
    const paint = () => {
      dirBox.replaceChildren(...Object.entries(DIR).map(([k, l]) => h('button', { type: 'button', class: (dir === k ? 'on ' : '') + (k === 'men' ? 'k-chiqim' : 'k-kirim'), disabled: !!d, 'aria-pressed': String(dir === k), onclick: () => { dir = k; paint(); } }, l)));
      curBox.replaceChildren(...[['UZS', 'So\'m'], ['USD', 'Dollar']].map(([k, l]) => h('button', { type: 'button', class: cur === k ? 'on' : '', disabled: !!d, 'aria-pressed': String(cur === k), onclick: () => { cur = k; paint(); } }, l)));
      whoLabel.textContent = dir === 'men' ? 'Kimdan qarz olganman' : 'Kimga qarz berganman';
      accLabel.textContent = dir === 'men' ? 'Pul qaysi hisobga tushdi' : 'Pul qaysi hisobdan chiqdi';
      const prev = accBox.querySelector('select')?.value || '';
      accBox.replaceChildren(accLabel, accPicker('d_acc', cur, prev), hint);
      hint.textContent = 'Eski qarz bo\'lsa yoki pul hamyonga kirmagan bo\'lsa — «Hisobga tegmasin» qoldiring.';
    };
    paint();
    setTimeout(() => { if (!d) person.focus(); }, 80);
    return [
      h('div', { class: 'field' }, h('label', {}, 'Kim kimga qarzdor'), dirBox),
      h('div', { class: 'field' }, whoLabel, person),
      !d && h('div', { class: 'field' }, h('label', { for: 'd_amt' }, 'Qarz summasi (hozir qancha qolgan)'), amt),
      !d && h('div', { class: 'field' }, h('label', {}, 'Valyuta'), curBox),
      !d && accBox,
      h('div', { class: 'row' },
        !d && h('div', { class: 'field', style: 'flex:1' }, h('label', { for: 'd_date' }, 'Qachon'), date),
        h('div', { class: 'field', style: 'flex:1' }, h('label', { for: 'd_due' }, 'Qaytarish muddati'), due)),
      h('div', { class: 'field' }, h('label', { for: 'd_note' }, 'Izoh (ixtiyoriy)'), note),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
        h('button', { class: 'btn', type: 'button', onclick: async (ev) => {
          if (!person.value.trim()) { err.textContent = 'Kimligini yozing'; person.focus(); return; }
          const v = d ? null : parseAmount(amt.value);
          if (!d && !(v > 0)) { err.textContent = 'Summani kiriting'; amt.focus(); return; }
          ev.target.disabled = true;
          const row = { person: person.value.trim(), due_date: due.value || null, note: note.value.trim() || null };
          if (d) {
            const { error } = await sb.from('fin_debts').update(row).eq('id', d.id);
            ev.target.disabled = false;
            if (error) { err.textContent = 'Saqlab bo\'lmadi: ' + error.message; return; }
            close(); reload('Saqlandi'); return;
          }
          const { data: nd, error } = await sb.from('fin_debts').insert({ ...row, direction: dir, currency: cur }).select().single();
          if (error || !nd) { ev.target.disabled = false; err.textContent = 'Saqlab bo\'lmadi: ' + (error?.message || ''); return; }
          const acc = accBox.querySelector('select')?.value || null;
          const { error: e2 } = await sb.from('fin_debt_events').insert({ debt_id: nd.id, type: 'oshdi', amount: v, account_id: acc, event_date: date.value || today() });
          if (e2) { await sb.from('fin_debts').delete().eq('id', nd.id); ev.target.disabled = false; err.textContent = 'Saqlab bo\'lmadi: ' + e2.message; return; }
          M.debtDir = dir; close(); go('#/pullar/qarz/' + nd.id); reload('Qarz qo\'shildi');
        } }, 'Saqlash'))];
  });
}
function eventSheet(d, type, e = null) {
  const men = d.direction === 'men', n = debtNums(d);
  const maxPay = n.left + (e && e.type === 'kamaydi' ? num(e.amount) : 0);
  const title = e ? 'Yozuvni tahrirlash' : type === 'kamaydi' ? (men ? 'Qarzni qaytardim' : 'Qarz qaytdi') : (men ? 'Yana qarz oldim' : 'Yana qarz berdim');
  const lastAcc = (() => { try { return localStorage.getItem('devon_m_acc'); } catch (x) { return null; } })();
  const defAcc = e ? e.account_id : type === 'kamaydi' && M.accounts.some((a) => a.id === lastAcc && a.currency === d.currency && !a.archived) ? lastAcc : '';
  sheet(title, (close) => {
    const amt = amountInput('e_amt', e ? num(e.amount) : null);
    const acc = accPicker('e_acc', d.currency, defAcc);
    const date = h('input', { class: 'input', id: 'e_date', type: 'date', value: e?.event_date || today() });
    const note = h('input', { class: 'input', id: 'e_note', maxlength: 300, value: e?.note || '' });
    const err = h('div', { class: 'err' });
    setTimeout(() => { if (!e) amt.focus(); }, 80);
    const inLabel = type === 'kamaydi' ? (men ? 'Qaysi hisobdan to\'ladim' : 'Qaysi hisobga tushdi') : (men ? 'Qaysi hisobga tushdi' : 'Qaysi hisobdan berdim');
    return [
      h('div', { class: 'field' }, h('label', { for: 'e_amt', class: 'between' }, h('span', {}, 'Summa'),
        type === 'kamaydi' && maxPay > 0 && h('button', { type: 'button', class: 'linkbtn', onclick: () => { amt.value = group(maxPay).replace(',00', ''); } }, `Hammasi: ${money(maxPay, d.currency)}`)), amt),
      h('div', { class: 'field' }, h('label', { for: 'e_acc' }, inLabel), acc),
      h('div', { class: 'field' }, h('label', { for: 'e_date' }, 'Sana'), date),
      h('div', { class: 'field' }, h('label', { for: 'e_note' }, 'Izoh (ixtiyoriy)'), note),
      err,
      h('div', { class: 'row' },
        e ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (evsOf(d).length === 1) { toast('Bu yagona yozuv. Butun qarzni o\'chirish uchun «O\'chirish» tugmasini bosing'); return; }
          if (!await confirmBox({ title: 'Yozuv o\'chirilsinmi?', ok: 'O\'chirish', danger: true })) return;
          const { error } = await sb.from('fin_debt_events').delete().eq('id', e.id);
          if (error) { toast('O\'chirib bo\'lmadi'); return; }
          close(); reload('O\'chirildi');
        } }, 'O\'chirish') : h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
        h('button', { class: 'btn', type: 'button', onclick: async (ev) => {
          const v = parseAmount(amt.value);
          if (!(v > 0)) { err.textContent = 'Summani kiriting'; amt.focus(); return; }
          if (type === 'kamaydi' && v > maxPay + 0.001) { err.textContent = `Qolgan qarzdan ko'p: ko'pi bilan ${money(maxPay, d.currency)}`; return; }
          if (type === 'oshdi' && e && evsOf(d).filter((x) => x.type === 'oshdi' && x.id !== e.id).reduce((s, x) => s + num(x.amount), 0) + v < n.paid - 0.001) { err.textContent = 'Bunda qaytarilgan summa qarzdan ko\'p bo\'lib qoladi'; return; }
          const row = { type, amount: v, account_id: acc.value || null, event_date: date.value || today(), note: note.value.trim() || null };
          ev.target.disabled = true;
          const { error } = e ? await sb.from('fin_debt_events').update(row).eq('id', e.id) : await sb.from('fin_debt_events').insert({ ...row, debt_id: d.id });
          ev.target.disabled = false;
          if (error) { err.textContent = 'Saqlab bo\'lmadi: ' + error.message; return; }
          if (acc.value) { try { localStorage.setItem('devon_m_acc', acc.value); } catch (x) { /* xotira yopiq */ } }
          const closing = !e && type === 'kamaydi' && Math.abs(v - maxPay) < 0.001;
          close(); reload(closing ? (men ? 'Qarz to\'liq yopildi' : 'Qarz to\'liq qaytdi') : 'Saqlandi');
        } }, 'Saqlash'))];
  });
}

// ---------- Sozlamalar: hisoblar, toifalar, himoya ----------
function accSheet(acc = null) {
  const used = acc && (M.tx.some((t) => t.account_id === acc.id || t.to_account_id === acc.id) || M.devs.some((e) => e.account_id === acc.id));
  sheet(acc ? 'Hisobni tahrirlash' : 'Yangi hisob', (close) => {
    const name = h('input', { class: 'input', id: 'a_name', maxlength: 60, value: acc?.name || '', placeholder: 'Masalan: Humo karta' });
    let kind = acc?.kind || 'karta', cur = acc?.currency || 'UZS';
    const kindBox = h('div', { class: 'seg' }), curBox = h('div', { class: 'seg' });
    const paint = () => {
      kindBox.replaceChildren(...Object.entries(KIND_ACC).map(([k, l]) => h('button', { type: 'button', class: kind === k ? 'on' : '', 'aria-pressed': String(kind === k), onclick: () => { kind = k; paint(); } }, l)));
      curBox.replaceChildren(...[['UZS', 'So\'m'], ['USD', 'Dollar']].map(([k, l]) => h('button', { type: 'button', class: cur === k ? 'on' : '', disabled: used, 'aria-pressed': String(cur === k), onclick: () => { cur = k; paint(); } }, l)));
    };
    paint();
    const open = amountInput('a_open', acc ? Math.abs(num(acc.opening_balance)) : null);
    const err = h('div', { class: 'err' });
    setTimeout(() => { if (!acc) name.focus(); }, 80);
    return [
      h('div', { class: 'field' }, h('label', { for: 'a_name' }, 'Nomi'), name),
      h('div', { class: 'field' }, h('label', {}, 'Turi'), kindBox),
      h('div', { class: 'field' }, h('label', {}, 'Valyuta'), curBox, used && h('small', { class: 't-meta' }, 'Yozuvlari bor hisobning valyutasi o\'zgarmaydi.')),
      h('div', { class: 'field' }, h('label', { for: 'a_open' }, acc ? 'Boshlang\'ich qoldiq' : 'Hozir unda qancha pul bor'), open),
      err,
      acc && h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        const { error } = await sb.from('fin_accounts').update({ archived: !acc.archived }).eq('id', acc.id);
        if (error) { toast('Saqlab bo\'lmadi'); return; }
        if (M.acc === acc.id) M.acc = null;
        close(); reload(acc.archived ? 'Hisob qaytarildi' : 'Hisob yashirildi');
      } }, acc.archived ? 'Hisobni qaytarish' : 'Hisobni yashirish (yozuvlari qoladi)'),
      acc && !used && h('button', { class: 'btn danger small', type: 'button', onclick: async () => {
        if (!await confirmBox({ title: 'Hisob o\'chirilsinmi?', ok: 'O\'chirish', danger: true })) return;
        const { error } = await sb.from('fin_accounts').delete().eq('id', acc.id);
        if (error) { toast('O\'chirib bo\'lmadi'); return; }
        close(); reload('O\'chirildi');
      } }, 'Hisobni o\'chirish'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!name.value.trim()) { err.textContent = 'Nomini yozing'; return; }
          const ob = open.value.trim() ? parseAmount(open.value) : 0;
          if (!Number.isFinite(ob)) { err.textContent = 'Qoldiqni to\'g\'ri yozing'; return; }
          const row = { name: name.value.trim(), kind, currency: cur, opening_balance: ob };
          const { error } = acc ? await sb.from('fin_accounts').update(row).eq('id', acc.id) : await sb.from('fin_accounts').insert({ ...row, sort: M.accounts.length });
          if (error) { err.textContent = 'Saqlab bo\'lmadi: ' + error.message; return; }
          close(); reload('Saqlandi');
        } }, 'Saqlash'))];
  });
}
function catSheet(cat = null, kind0 = 'chiqim') {
  const kind = cat?.kind || kind0;
  sheet(cat ? 'Toifani tahrirlash' : (kind === 'kirim' ? 'Yangi kirim toifasi' : 'Yangi chiqim toifasi'), (close) => {
    const emoji = h('input', { class: 'input', id: 'c_emo', maxlength: 4, value: cat?.emoji || '', placeholder: '🙂', style: 'width:72px;text-align:center;font-size:20px' });
    const name = h('input', { class: 'input', id: 'c_name', maxlength: 40, value: cat?.name || '', placeholder: 'Masalan: Sport zal' });
    const lim = amountInput('c_lim', cat?.monthly_limit ? num(cat.monthly_limit) : null);
    const err = h('div', { class: 'err' });
    setTimeout(() => { if (!cat) name.focus(); }, 80);
    return [
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'c_emo' }, 'Belgi'), emoji), h('div', { class: 'field', style: 'flex:1' }, h('label', { for: 'c_name' }, 'Nomi'), name)),
      kind === 'chiqim' && h('div', { class: 'field' }, h('label', { for: 'c_lim' }, 'Oylik limit, so\'m (ixtiyoriy)'), lim, h('small', { class: 't-meta' }, 'Limitga yaqinlashsa sariq, oshib ketsa qizil bo\'ladi.')),
      err,
      cat && h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        const { error } = await sb.from('fin_categories').update({ archived: !cat.archived }).eq('id', cat.id);
        if (error) { toast('Saqlab bo\'lmadi'); return; }
        close(); reload(cat.archived ? 'Toifa qaytarildi' : 'Toifa yashirildi');
      } }, cat.archived ? 'Toifani qaytarish' : 'Toifani yashirish (eski yozuvlar qoladi)'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Bekor'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!name.value.trim()) { err.textContent = 'Nomini yozing'; return; }
          const l = kind === 'chiqim' && lim.value.trim() ? parseAmount(lim.value) : null;
          if (l !== null && !(l > 0)) { err.textContent = 'Limitni to\'g\'ri yozing'; return; }
          const row = { name: name.value.trim(), emoji: emoji.value.trim() || null, monthly_limit: l };
          const { error } = cat ? await sb.from('fin_categories').update(row).eq('id', cat.id) : await sb.from('fin_categories').insert({ ...row, kind, sort: M.cats.filter((c) => c.kind === kind).length });
          if (error) { err.textContent = 'Saqlab bo\'lmadi: ' + error.message; return; }
          close(); reload('Saqlandi');
        } }, 'Saqlash'))];
  });
}

function exportRows() {
  const rows = [['Sana', 'Turi', 'Summa', 'Valyuta', 'Hisob', 'Qaysi hisobga', 'Toifa', 'Izoh'],
    ...[...M.tx].sort((x, y) => x.tx_date.localeCompare(y.tx_date)).map((t) => [fmtDate(t.tx_date), KIND_TX[t.kind], num(t.amount), curOf(t.account_id), accOf(t.account_id)?.name || '', t.to_account_id ? accOf(t.to_account_id)?.name || '' : '', catOf(t.category_id)?.name || '', t.note || ''])];
  const accs = [['Hisob', 'Turi', 'Valyuta', 'Boshlang\'ich qoldiq', 'Hozirgi qoldiq', 'Yashirilgan'],
    ...M.accounts.map((x) => [x.name, KIND_ACC[x.kind], x.currency, num(x.opening_balance), balance(x), x.archived ? 'Ha' : ''])];
  const months = {};
  for (const t of M.tx) { if (t.kind === 'otkazma' || curOf(t.account_id) !== 'UZS') continue; const m = t.tx_date.slice(0, 7); months[m] = months[m] || { kirim: 0, chiqim: 0 }; months[m][t.kind] += num(t.amount); }
  const mon = [['Oy', 'Kirim (so\'m)', 'Chiqim (so\'m)', 'Farq'], ...Object.keys(months).sort().map((m) => [monthName(m + '-01'), months[m].kirim, months[m].chiqim, months[m].kirim - months[m].chiqim])];
  const cats = {};
  for (const t of M.tx) { if (t.kind !== 'chiqim' || curOf(t.account_id) !== 'UZS') continue; const k = `${t.tx_date.slice(0, 7)}|${catOf(t.category_id)?.name || 'Toifasiz'}`; cats[k] = (cats[k] || 0) + num(t.amount); }
  const byCat = [['Oy', 'Toifa', 'Chiqim (so\'m)'], ...Object.keys(cats).sort().map((k) => { const [m, c] = k.split('|'); return [monthName(m + '-01'), c, cats[k]]; })];
  const debts = [['Kim', 'Turi', 'Valyuta', 'Jami', 'Qaytarilgan', 'Qolgan', 'Muddat', 'Izoh'],
    ...M.debts.map((d) => { const n = debtNums(d); return [d.person, DIR[d.direction], d.currency, n.total, n.paid, n.left, d.due_date ? fmtDate(d.due_date) : '', d.note || '']; })];
  const devs = [['Sana', 'Kim', 'Harakat', 'Summa', 'Valyuta', 'Hisob', 'Izoh'],
    ...M.devs.map((e) => { const d = debtOf(e.debt_id) || {}; return [fmtDate(e.event_date), d.person || '', e.type === 'oshdi' ? (d.direction === 'men' ? 'Qarz oldim' : 'Qarz berdim') : (d.direction === 'men' ? 'Qaytardim' : 'Qaytardi'), num(e.amount), d.currency || '', e.account_id ? accOf(e.account_id)?.name || '' : '', e.note || '']; })];
  return [['Yozuvlar', rows], ['Oylar', mon], ['Toifalar', byCat], ['Hisoblar', accs], ['Qarzlar', debts], ['Qarz tarixi', devs]];
}
let exporting = false;
async function exportExcel() {
  if (!M.tx.length && !M.debts.length) { toast('Hali yozuv yo\'q'); return; }
  const blob = buildXlsx(exportRows()), name = `Pullar_${today()}.xlsx`;
  if (!(S.settings.drive && S.settings.drive.connected)) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Excel fayl yuklab olindi'); return;
  }
  if (exporting) return;
  exporting = true; toast('Excel fayl Google Drive\'ga joylanmoqda…');
  try {
    const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(blob); });
    const { data: res, error } = await sb.functions.invoke('eksport', { body: { name, data } });
    if (error || !res || !res.url) { toast('Drive\'ga joylab bo\'lmadi'); return; }
    sheet('Excel fayl tayyor', (close) => [
      h('p', { class: 't-meta' }, `«${res.name}» Google Drive'ingizga joylandi.`),
      h('a', { class: 'btn', href: res.url, target: '_blank', rel: 'noopener', onclick: () => setTimeout(close, 300) }, 'Drive\'da ochish'),
      h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Yopish')]);
  } finally { exporting = false; }
}

export function MoneySettings() {
  if (!moneyAllowed()) { go('#/bugun'); return h('main', { class: 'view' }); }
  if (!M.loaded) return Loading(BackHead('Pullar sozlamalari', '#/pullar'));
  if (M.set?.pin_hash && !M.unlocked) return Lock();
  const row = (title, sub, onclick, right) => h('button', { type: 'button', onclick }, h('span', { style: 'min-width:0' }, h('b', {}, title), sub && h('small', {}, sub)), right || icon('next', 18, 'currentColor'));
  const cats = M.cats.filter((c) => c.kind === M.catKind).sort((x, y) => Number(x.archived) - Number(y.archived) || x.sort - y.sort);
  const accs = [...M.accounts].sort((x, y) => Number(x.archived) - Number(y.archived) || x.sort - y.sort);
  return h('main', { class: 'view' },
    BackHead('Pullar sozlamalari', '#/pullar'),
    h('div', { class: 'section' }, h('h2', {}, 'Hisoblar'), h('button', { class: 'btn pill small ghost', type: 'button', onclick: () => accSheet() }, '+ Hisob')),
    h('div', { class: 'list' }, accs.map((x) => row(x.name + (x.archived ? ' (yashirilgan)' : ''), `${KIND_ACC[x.kind]} · ${x.currency === 'USD' ? 'dollar' : 'so\'m'}`, () => accSheet(x),
      h('b', { style: 'white-space:nowrap;font-size:14px' }, money(balance(x), x.currency))))),
    h('div', { class: 'section' }, h('h2', {}, 'Toifalar'), h('button', { class: 'btn pill small ghost', type: 'button', onclick: () => catSheet(null, M.catKind) }, '+ Toifa')),
    h('div', { class: 'seg' }, [['chiqim', 'Chiqim'], ['kirim', 'Kirim']].map(([k, l]) => h('button', { type: 'button', class: M.catKind === k ? 'on' : '', 'aria-pressed': String(M.catKind === k), onclick: () => { M.catKind = k; bus.render(); } }, l))),
    h('div', { class: 'list' }, cats.map((c) => row(`${c.emoji ? c.emoji + '  ' : ''}${c.name}${c.archived ? ' (yashirilgan)' : ''}`, c.monthly_limit ? `Oylik limit: ${money(num(c.monthly_limit))}` : null, () => catSheet(c)))),
    h('div', { class: 'section' }, h('h2', {}, 'Himoya')),
    h('div', { class: 'list' },
      row(M.set?.pin_hash ? 'PIN-kodni almashtirish' : 'PIN-kod qo\'yish', 'Bo\'limga kirishda so\'raladi', pinSheet),
      M.set?.pin_hash && row('PIN-kodni olib tashlash', null, async () => { if (await confirmBox({ title: 'PIN-kod olib tashlansinmi?', ok: 'Olib tashlash' }) && await saveSettings({ pin_hash: null })) { toast('PIN-kod olib tashlandi'); bus.render(); } }),
      row(hidden() ? 'Summalarni ko\'rsatish' : 'Summalarni yashirish', 'Odamlar orasida ochganda raqamlar ko\'rinmaydi', async () => { if (await saveSettings({ hide_amounts: !hidden() })) bus.render(); })),
    h('div', { class: 'section' }, h('h2', {}, 'Fayl')),
    h('div', { class: 'list' }, row('Excelga chiqarish', 'Hamma yozuvlar, oylar, toifalar, hisoblar va qarzlar', exportExcel)),
    h('div', { class: 't-meta', style: 'padding:4px 4px 0' }, 'Bu bo\'limdagi ma\'lumotlarni faqat siz ko\'rasiz. Ular bildirishnoma, umumiy statistika va hisobotlarga tushmaydi.'));
}
