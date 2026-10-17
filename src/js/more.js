import { sb, S, bus, h, icon, toast, today, iso, fmtDate, fmtDateTime, dayOf, isOpen, onTime, nameOf, STATUS, go, BackHead, Empty,
  addDays, monthStart, monthEnd, monthName, owner, loadTasks, loadBase, ping } from './core.js';

S.notifs = []; S.kudos = [];
const forOf = (i) => i.for_id || i.owner_id;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* xotira yopiq */ } } };

export async function loadMore() {
  const [n, k] = await Promise.all([
    sb.from('notifications').select('*').eq('user_id', S.me.id).order('created_at', { ascending: false }).limit(100),
    sb.from('kudos').select('*').order('created_at', { ascending: false }).limit(200),
  ]);
  if (!n.error) S.notifs = n.data || [];
  if (!k.error) S.kudos = k.data || [];
}

// ---------- Ko'rinish: rang va tungi rejim ----------
const ACCENTS = { yashil: ['Yashil', '#0B6B58'], kok: ['Ko\'k', '#1F5FBF'], binafsha: ['Binafsha', '#6B3FA0'], jigar: ['Jigarrang', '#8A4B14'] };
export function applyTheme() {
  const mode = store.get('devon_mode') || 'auto', acc = store.get('devon_rang') || 'yashil';
  const dark = mode === 'tun' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'tun' : 'kun';
  document.documentElement.dataset.rang = ACCENTS[acc] ? acc : 'yashil';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0F1513' : ACCENTS[acc]?.[1] || '#0B6B58');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- Bildirishnomalar markazi ----------
export const unread = () => S.notifs.filter((n) => !n.read_at).length;
export function Bell() {
  const n = unread();
  return h('a', { class: 'iconbtn', href: '#/xabarlar', 'aria-label': n ? `Bildirishnomalar, ${n} ta yangi` : 'Bildirishnomalar', style: 'position:relative' },
    icon('bell', 20), n > 0 && h('span', { class: 'dot' }, n > 9 ? '9+' : n));
}
const target = (n) => (n.ref_type === 'task' && n.ref_id ? `#/ish/${n.ref_id}` : n.ref_type === 'request' || n.ref_type === 'report' ? '#/tasdiq' : n.ref_type === 'plan' ? '#/hisobot' : n.ref_type === 'event' ? '#/taqvim' : null);
async function markRead(ids) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  for (const n of S.notifs) if (ids.includes(n.id)) n.read_at = now;
  await Promise.all(ids.map((id) => sb.from('notifications').update({ read_at: now }).eq('id', id)));
}
export function Notifications() {
  const rows = S.notifs;
  return h('main', { class: 'view' },
    BackHead('Bildirishnomalar', '#/bugun'),
    unread() > 0 && h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { await markRead(rows.filter((n) => !n.read_at).map((n) => n.id)); bus.render(); } }, 'Hammasini o\'qilgan deb belgilash'),
    rows.length ? h('div', { class: 'list' }, rows.map((n) => h('button', { type: 'button', style: 'min-height:68px;padding-top:10px;padding-bottom:10px', onclick: async () => {
      if (!n.read_at) await markRead([n.id]);
      const to = target(n); if (to && !(n.ref_type === 'task' && !S.tasks.some((t) => t.id === n.ref_id))) go(to); else bus.render();
    } },
      h('span', { style: 'min-width:0' }, h('b', { style: n.read_at ? 'font-weight:500' : '' }, !n.read_at && h('i', { class: 'newdot' }), n.title),
        n.body && h('small', { style: 'display:block;overflow-wrap:anywhere' }, n.body), h('small', {}, fmtDateTime(n.created_at))),
      target(n) && icon('next', 18, 'currentColor')))) : Empty('Bildirishnoma yo\'q', 'Yangi topshiriq, javob va izohlar shu yerda ko\'rinadi.'));
}

// ---------- «Rahmat» va «Zo'r ish» ----------
const KUDO = { rahmat: 'Rahmat', zor_ish: 'Zo\'r ish' };
export function KudosBlock(t) {
  const got = S.kudos.filter((k) => k.task_id === t.id);
  const mine = got.some((k) => k.from_id === S.me.id);
  const canGive = t.status === 'bajarildi' && t.assignee_id !== S.me.id && !mine;
  if (!got.length && !canGive) return null;
  const give = async (kind) => {
    const { error } = await sb.from('kudos').insert({ from_id: S.me.id, to_id: t.assignee_id, task_id: t.id, kind });
    if (error) { toast('Yuborib bo\'lmadi'); return; }
    ping(t.assignee_id, 'rahmat', `${nameOf(S.me.id, true)}: ${KUDO[kind]}`, t.title, 'task', t.id);
    await loadMore(); toast('Yuborildi'); bus.render();
  };
  return h('section', { class: 'card' },
    got.map((k) => h('div', { class: 'kudo' }, icon('heart', 18), h('span', {}, h('b', {}, `${nameOf(k.from_id, true)}: ${KUDO[k.kind]}`), h('small', { class: 't-meta', style: 'display:block' }, fmtDateTime(k.created_at))))),
    canGive && h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => give('rahmat') }, 'Rahmat'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => give('zor_ish') }, 'Zo\'r ish')));
}
/** Bosh sahifa: menga kelgan, hali ko'rilmagan minnatdorchilik. Bir marta silkinadi. */
export function HomeKudos() {
  const key = 'devon_kudos_' + S.me.id, seen = store.get(key) || '';
  const fresh = S.kudos.filter((k) => k.to_id === S.me.id && k.created_at > seen).slice(0, 3);
  if (!fresh.length) return null;
  return h('section', { class: 'card kudocard shake' },
    fresh.map((k) => { const t = S.tasks.find((x) => x.id === k.task_id); return h('div', { class: 'kudo' }, icon('heart', 20), h('span', {}, h('b', {}, `${nameOf(k.from_id, true)}: ${KUDO[k.kind]}`), t && h('small', { class: 't-meta', style: 'display:block' }, t.title))); }),
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => { store.set(key, fresh[0].created_at); bus.render(); } }, 'Ko\'rdim'));
}

// ---------- Ketma-ket kunlar va oylik yutuqlar ----------
/** Rejasi bor kunlar ichida hamma o'z bandi bajarilgan kunlar ketma-ketligi. Rejasiz kun hisobni buzmaydi. */
export function streak() {
  const o = owner().id, days = {};
  for (const i of S.plan) if (i.owner_id === o && forOf(i) === o && i.plan_date <= today()) (days[i.plan_date] = days[i.plan_date] || []).push(i.done);
  let n = 0;
  for (const d of Object.keys(days).sort().reverse()) {
    const full = days[d].every(Boolean);
    if (!full) { if (d === today()) continue; break; } // bugun hali tugamagan bo'lsa, hisobni buzmaydi
    n++;
  }
  return n;
}
export function StreakChip() {
  const n = streak();
  return n >= 2 ? h('div', { class: 'streak' }, icon('flame', 16), `Ketma-ket ${n} kun reja to'liq bajarildi`) : null;
}
export function achievements(month = today()) {
  const o = owner().id, a = monthStart(month), b = monthEnd(month), goal = S.settings.maqsad || { vaqtida_foiz: 90 };
  const done = S.tasks.filter((t) => t.assignee_id === o && t.status === 'bajarildi' && onTime(t) !== null && dayOf(t.submitted_at || t.closed_at) >= a && dayOf(t.submitted_at || t.closed_at) <= b);
  const good = done.filter(onTime).length, pct = done.length ? Math.round((good / done.length) * 100) : 0;
  const early = done.filter((t) => dayOf(t.submitted_at || t.closed_at) < t.due_date).length;
  const reps = S.reports.filter((r) => r.owner_id === o && r.doc_type === 'hisobot' && r.period === 'kunlik' && r.status !== 'qoralama' && r.period_start >= a && r.period_start <= b);
  const repOk = reps.filter((r) => r.on_time !== false).length;
  const days = {};
  for (const i of S.plan) if (i.owner_id === o && forOf(i) === o && i.plan_date >= a && i.plan_date <= b) (days[i.plan_date] = days[i.plan_date] || []).push(i.done);
  const fullDays = Object.values(days).filter((x) => x.every(Boolean)).length;
  return [
    { name: 'Vaqtida', text: `Oyda kamida 5 topshiriq, ${goal.vaqtida_foiz}% va undan ko'pi vaqtida`, have: done.length >= 5 && pct >= goal.vaqtida_foiz, now: `${done.length} ta, ${pct}%` },
    { name: 'Intizom', text: 'Oyda kamida 10 kunlik hisobot, hammasi o\'z vaqtida', have: reps.length >= 10 && repOk === reps.length, now: `${repOk} / ${reps.length}` },
    { name: 'To\'liq reja', text: 'Oyda 10 kun reja to\'liq bajarilgan', have: fullDays >= 10, now: `${fullDays} / 10` },
    { name: 'Tezkor', text: '5 topshiriq muddatidan oldin bajarilgan', have: early >= 5, now: `${Math.min(early, 5)} / 5` },
    { name: 'Barokatli hafta', text: 'Ketma-ket 7 kun reja to\'liq bajarilgan', have: streak() >= 7, now: `${Math.min(streak(), 7)} / 7` },
  ];
}
export function AchievementsCard() {
  const list = achievements();
  return [h('div', { class: 'section' }, h('h2', {}, `Yutuqlar · ${monthName(today())}`), h('span', { class: 't-meta' }, `${list.filter((x) => x.have).length} / ${list.length}`)),
    h('section', { class: 'card', style: 'gap:0' }, list.map((x) => h('div', { class: 'ach' + (x.have ? ' have' : '') },
      h('span', { class: 'medal' }, icon(x.have ? 'check' : 'star', 20)),
      h('span', { style: 'flex:1;min-width:0' }, h('b', {}, x.name), h('small', { class: 't-meta', style: 'display:block' }, x.text)),
      h('span', { class: 't-meta', style: 'font-weight:700;white-space:nowrap' }, x.have ? 'Olindi' : x.now))))];
}

// ---------- Mening sozlamalarim ----------
// ---------- Pastki menyu: o'rtadagi bo'limlarni har kim o'zi tanlaydi (shu telefonda saqlanadi) ----------
export const NAV_CHOICES = [['#/ishlar', 'Ishlar', 'list'], ['#/taqvim', 'Taqvim', 'cal'], ['#/tasdiq', 'Tasdiq', 'check'], ['#/hisobot', 'Hisobot', 'chart'], ['#/statistika', 'Statistika', 'stats'],
  ['#/eslatmalar', 'Eslatma', 'bell'], ['#/kutilmoqda', 'Kutilmoqda', 'clock']];
const NAV_DEFAULT = ['#/ishlar', '#/taqvim', '#/tasdiq', '#/hisobot'], NAV_MAX = 4;
function navPick() {
  let p = null; try { p = JSON.parse(store.get('devon_nav') || 'null'); } catch (e) { /* buzilgan */ }
  return Array.isArray(p) && p.length ? p.filter((x) => NAV_CHOICES.some(([hh]) => hh === x)).slice(0, NAV_MAX) : NAV_DEFAULT;
}
export function navItems() {
  const p = navPick();
  return [['#/bugun', 'Bugun', 'home'], ...NAV_CHOICES.filter(([hh]) => p.includes(hh)), ['#/yana', 'Yana', 'more']];
}
function NavSettings() {
  const p = navPick();
  return [h('div', { class: 'section' }, h('h2', {}, 'Pastki menyu')),
    h('section', { class: 'card' },
      h('div', { class: 't-meta' }, `«Bugun» va «Yana» doim turadi. O'rtaga ${NAV_MAX} tagacha bo'limni o'zingiz tanlang.`),
      NAV_CHOICES.map(([href, label, ic]) => {
        const box = h('input', { type: 'checkbox', checked: p.includes(href), onchange: () => {
          const next = box.checked ? [...p, href] : p.filter((x) => x !== href);
          if (next.length > NAV_MAX) { box.checked = false; toast(`Ko'pi bilan ${NAV_MAX} ta. Avval bittasini olib tashlang`); return; }
          if (!next.length) { box.checked = true; toast('Kamida bitta bo\'lim qolsin'); return; }
          store.set('devon_nav', JSON.stringify(next)); bus.render();
        } });
        return h('label', { class: 'check' }, box, icon(ic, 20), href === '#/eslatmalar' ? 'Eslatmalar' : label);
      }),
      h('div', { class: 't-meta' }, 'Tanlov faqat shu telefonda saqlanadi. Kompyuterda hamma bo\'limlar chap menyuda doim ko\'rinadi.'))];
}

export function MySettings() {
  const mode = store.get('devon_mode') || 'auto', acc = store.get('devon_rang') || 'yashil';
  const prefs = S.me.prefs || {};
  const pick = (cur, val, label, fn) => h('button', { type: 'button', class: cur === val ? 'on' : '', 'aria-pressed': String(cur === val), onclick: () => { fn(val); applyTheme(); bus.render(); } }, label);
  const from = h('input', { class: 'input', type: 'time', id: 'q_from', value: prefs.tinch_dan || '21:00' });
  const to = h('input', { class: 'input', type: 'time', id: 'q_to', value: prefs.tinch_gacha || '07:00' });
  const quiet = h('input', { type: 'checkbox', checked: prefs.tinch !== false });
  const only = h('input', { type: 'checkbox', checked: !!prefs.faqat_muhim });
  return h('main', { class: 'view' },
    BackHead('Mening sozlamalarim', '#/yana'),
    h('div', { class: 'section' }, h('h2', {}, 'Ko\'rinish')),
    h('section', { class: 'card' },
      h('div', { class: 't-meta' }, 'Rejim'),
      h('div', { class: 'seg' }, pick(mode, 'auto', 'Telefon bo\'yicha', (v) => store.set('devon_mode', v)), pick(mode, 'kun', 'Yorug\'', (v) => store.set('devon_mode', v)), pick(mode, 'tun', 'Tungi', (v) => store.set('devon_mode', v))),
      h('div', { class: 't-meta' }, 'Asosiy rang'),
      h('div', { class: 'swatches' }, Object.entries(ACCENTS).map(([k, [label, col]]) => h('button', { type: 'button', class: 'swatch' + (acc === k ? ' on' : ''), 'aria-pressed': String(acc === k), onclick: () => { store.set('devon_rang', k); applyTheme(); bus.render(); } },
        h('i', { style: `background:${col}` }), label))),
      h('div', { class: 't-meta' }, 'Ko\'rinish faqat shu qurilmada saqlanadi.')),
    NavSettings(),
    h('div', { class: 'section' }, h('h2', {}, 'Bildirishnomalar')),
    h('section', { class: 'card' },
      h('label', { class: 'check' }, quiet, 'Tinch soatlarda bezovta qilinmasin'),
      h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1' }, h('label', { for: 'q_from' }, 'Dan'), from), h('div', { class: 'field', style: 'flex:1' }, h('label', { for: 'q_to' }, 'Gacha'), to)),
      h('label', { class: 'check' }, only, 'Faqat muhimlari kelsin (tasdiq so\'rovi, muddati o\'tgan ish)'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!from.value || !to.value) { toast('Ikkala vaqtni ham kiriting'); return; }
        const { error } = await sb.from('profiles').update({ prefs: { ...prefs, tinch: quiet.checked, tinch_dan: from.value, tinch_gacha: to.value, faqat_muhim: only.checked } }).eq('id', S.me.id);
        if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return; }
        await loadBase(); toast('Saqlandi'); bus.render();
      } }, 'Saqlash'),
      h('div', { class: 't-meta' }, 'Bu sozlamalar telefonga bildirishnoma ulangandan keyin kuchga kiradi. Dastur ichidagi qo\'ng\'iroqchada hamma xabar ko\'rinaveradi.')));
}

// ---------- Matndan topshiriq qo'shish ----------
function parseLine(raw) {
  let s = raw.replace(/^\s*(\d+[.)]|[-–—•*])\s*/, '').trim();
  if (!s) return null;
  let due = null, m;
  if ((m = s.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today().slice(0, 4);
    const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(d + 'T12:00:00')) && Number(m[2]) <= 12 && Number(m[1]) <= 31) { due = !m[3] && d < today() ? `${Number(y) + 1}${d.slice(4)}` : d; s = s.replace(m[0], ''); }
  } else if ((m = s.match(/\bbugun(gacha)?\b/i))) { due = today(); s = s.replace(m[0], ''); }
  else if ((m = s.match(/\bertaga(gacha)?\b/i))) { due = addDays(today(), 1); s = s.replace(m[0], ''); }
  else if ((m = s.match(/\b(\d{1,2})\s*kun(da| ichida)?\b/i))) { due = addDays(today(), Number(m[1])); s = s.replace(m[0], ''); }
  let who = S.me.id;
  for (const p of S.profiles) { const first = p.full_name.split(' ')[0].toLowerCase(); if (p.id !== S.me.id && first.length > 2 && s.toLowerCase().includes(first)) who = p.id; }
  s = s.replace(/\s*(muddat|gacha|—|–|-)\s*[:.]?\s*$/i, '').replace(/\s{2,}/g, ' ').replace(/[\s,;:]+$/, '').trim();
  return s ? { title: s.slice(0, 200), due: due || addDays(today(), 3), who, on: true, guessed: !due } : null;
}
const T = { text: '', rows: null };
export function FromText() {
  if (!T.rows) {
    const ta = h('textarea', { class: 'input', id: 'ft', style: 'min-height:220px', value: T.text, placeholder: '1. Shartnomani tayyorlash 15.10\n2. Bank bilan gaplashish ertaga\n3. Hisobotni tekshirish 5 kun' });
    return h('main', { class: 'view' },
      BackHead('Matndan qo\'shish', '#/ishlar'),
      h('div', { class: 't-meta', style: 'padding:0 4px' }, 'Har bir qator alohida topshiriq bo\'ladi. Muddatni qatorda yozsangiz o\'zi topadi: «15.10», «bugun», «ertaga», «5 kun». Yozilmasa 3 kun qo\'yiladi. Keyingi oynada hammasini tekshirib, tuzatasiz.'),
      h('div', { class: 'field' }, h('label', { for: 'ft' }, 'Matn'), ta),
      h('button', { class: 'btn', type: 'button', onclick: () => { T.text = ta.value; const rows = ta.value.split('\n').map(parseLine).filter(Boolean); if (!rows.length) { toast('Matnda topshiriq topilmadi'); return; } T.rows = rows; bus.render(); } }, 'Ajratish'));
  }
  const n = T.rows.filter((r) => r.on).length;
  return h('main', { class: 'view' },
    BackHead('Tekshirib oling', '#/ishlar'),
    h('div', { class: 't-meta', style: 'padding:0 4px' }, `${T.rows.length} ta qator topildi. Keraksizining belgisini olib tashlang, nom, muddat va mas'ulni tuzating.`),
    T.rows.map((r, i) => h('section', { class: 'card', style: r.on ? '' : 'opacity:.55' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.on, 'aria-label': `${i + 1}-topshiriqni qo'shish`, onchange: (e) => { r.on = e.target.checked; bus.render(); } }), `${i + 1}-topshiriq`, r.guessed && h('span', { class: 'chip amber', style: 'margin-left:auto' }, 'muddat taxminiy')),
      h('input', { class: 'input', 'aria-label': 'Nomi', value: r.title, maxlength: 200, oninput: (e) => { r.title = e.target.value; } }),
      h('div', { class: 'row' },
        h('input', { class: 'input', type: 'date', 'aria-label': 'Muddat', value: r.due, min: today(), onchange: (e) => { r.due = e.target.value; r.guessed = false; } }),
        (() => { const sel = h('select', { class: 'input', 'aria-label': 'Mas\'ul', onchange: (e) => { r.who = e.target.value; } }, S.profiles.map((p) => h('option', { value: p.id }, p.id === S.me.id ? 'Menga' : nameOf(p.id, true)))); sel.value = r.who; return sel; })()))),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { T.rows = null; bus.render(); } }, 'Matnga qaytish'),
      h('button', { class: 'btn', type: 'button', disabled: n === 0, onclick: async (e) => {
        const rows = T.rows.filter((r) => r.on);
        if (rows.some((r) => !r.title.trim() || !r.due)) { toast('Har bir topshiriqda nom va muddat bo\'lishi kerak'); return; }
        e.target.disabled = true; let ok = 0;
        for (const r of rows) {
          const { error } = await sb.from('tasks').insert({ title: r.title.trim(), creator_id: S.me.id, assignee_id: r.who, due_date: r.due, original_due_date: r.due });
          if (!error) { ok++; ping(r.who, 'topshiriq', 'Yangi topshiriq', r.title.trim(), 'task', null); }
        }
        await loadTasks();
        if (ok === rows.length) { T.rows = null; T.text = ''; toast(`${ok} ta topshiriq qo'shildi`); go('#/ishlar'); }
        else { toast(`${ok} tasi qo'shildi, ${rows.length - ok} tasi qo'shilmadi`); T.rows = T.rows.filter((r) => !r.on).concat(rows.slice(ok)); bus.render(); }
      } }, `${n} ta topshiriqni qo'shish`)));
}

// ---------- Excelga chiqarish (kutubxonasiz .xlsx) ----------
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30)); head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, nm.length, true);
    const cen = new DataView(new ArrayBuffer(46)); cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nm.length, true); cen.setUint32(42, off, true);
    parts.push(new Uint8Array(head.buffer), nm, data); central.push(new Uint8Array(cen.buffer), nm); off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const esc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
function sheetXml(rows) {
  const widths = rows[0].map((_, c) => Math.min(60, Math.max(10, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))));
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = col(ci) + (ri + 1);
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
}
export function buildXlsx(sheets) {
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name], i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows)]),
  ];
  return zip(files);
}
export function exportSheets() {
  const c = (id) => (S.contacts.find((x) => x.id === id) || {}).name || '';
  const tasks = [['№', 'Topshiriq', 'Izoh', 'Topshiruvchi', 'Mas\'ul', 'Holati', 'Muddat', 'Asl muddat', 'Ko\'chirilgan (marta)', 'Yaratilgan', 'Qabul qilingan', 'Bajarilgan', 'Vaqtida', 'Natija', 'Kimdan kutilmoqda', 'Vakolat darajasi', 'Qaytarilgan (marta)'],
    ...[...S.tasks].sort((a, b) => a.seq - b.seq).map((t) => [t.seq, t.title, t.description || '', nameOf(t.creator_id), nameOf(t.assignee_id), STATUS[t.status], fmtDate(t.due_date), t.original_due_date ? fmtDate(t.original_due_date) : '', t.reschedule_count || 0,
      fmtDate(dayOf(t.created_at)), t.accepted_at ? fmtDate(dayOf(t.accepted_at)) : '', t.submitted_at ? fmtDate(dayOf(t.submitted_at)) : '', t.status === 'bajarildi' && onTime(t) !== null ? (onTime(t) ? 'Ha' : 'Yo\'q') : '', t.result || '', c(t.waiting_on), t.level || '', t.returned_count || 0])];
  const plan = [['Sana', 'Vaqt', 'Band', 'Kimniki', 'Bajarildi', 'Tasdiqdan keyin qo\'shilgan'],
    ...[...S.plan].sort((a, b) => a.plan_date.localeCompare(b.plan_date) || (a.at_time || '99').localeCompare(b.at_time || '99')).map((i) => [fmtDate(i.plan_date), (i.at_time || '').slice(0, 5), i.title, nameOf(forOf(i)), i.done ? 'Ha' : 'Yo\'q', i.added_after_approval ? 'Ha' : ''])];
  const DOC = { reja: 'Reja', hisobot: 'Hisobot' }, PER = { kunlik: 'Kunlik', haftalik: 'Haftalik', oylik: 'Oylik' }, ST = { qoralama: 'Yuborilmagan', yuborildi: 'Tasdiq kutilmoqda', tasdiqlandi: 'Tasdiqlandi', qaytarildi: 'Qaytarildi' };
  const reps = [['Turi', 'Davr', 'Boshlanishi', 'Tugashi', 'Holati', 'Yuborilgan', 'O\'z vaqtida', 'Tasdiqlangan', 'Izoh', 'Matn'],
    ...S.reports.filter((r) => r.status !== 'qoralama').map((r) => [DOC[r.doc_type], PER[r.period], fmtDate(r.period_start), fmtDate(r.period_end), ST[r.status], r.sent_at ? fmtDateTime(r.sent_at) : '', r.on_time === false ? 'Yo\'q' : r.on_time ? 'Ha' : '', r.approved_at ? fmtDateTime(r.approved_at) : '', r.approver_comment || '', r.body || ''])];
  return [['Topshiriqlar', tasks], ['Reja', plan], ['Hisobotlar', reps]];
}
let exporting = false;
export async function downloadExcel() {
  const blob = buildXlsx(exportSheets()), name = `Devon_${today()}.xlsx`;
  const drive = S.settings.drive && S.settings.drive.connected;
  if (!drive) {
    // Drive ulanmagan bo'lsa (kompyuterdagi brauzer) — oddiy yuklab olish
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Excel fayl yuklab olindi'); return;
  }
  // Telefondagi ilova faylni o'zi saqlay olmaydi: Google Drive'ga joylab, o'sha yerda ochamiz
  if (exporting) return;
  exporting = true; toast('Excel fayl Google Drive\'ga joylanmoqda…');
  try {
    const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(blob); });
    const { data: res, error } = await sb.functions.invoke('eksport', { body: { name, data } });
    if (error || !res || !res.url) {
      let msg = 'Drive\'ga joylab bo\'lmadi';
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* matn yo'q */ }
      toast(msg); return;
    }
    const close = () => ov.remove();
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, 'Excel fayl tayyor'),
        h('p', { class: 't-meta' }, `«${res.name}» Google Drive'dagi «Devon fayllari» papkasiga joylandi.`),
        h('a', { class: 'btn', href: res.url, target: '_blank', rel: 'noopener', onclick: () => setTimeout(close, 300) }, 'Drive\'da ochish'),
        h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Yopish')));
    document.body.append(ov);
  } finally { exporting = false; }
}
