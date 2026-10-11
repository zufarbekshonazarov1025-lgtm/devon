import { TaskCard } from './views.js';
import { sb, S, bus, h, icon, toast, confirmBox, today, iso, fmtDate, isOpen, nameOf, go, Head, BackHead, Empty,
  addDays, mondayOf, monthStart, monthEnd, fmtDay, monthName, loadTasks, loadBase, ping } from './core.js';

S.events = []; S.reminders = []; S.recs = [];
const HAFTA_Q = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
const HAFTA_T = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const wd = (s) => ((new Date(s + 'T12:00:00').getDay() + 6) % 7) + 1; // 1 = dushanba … 7 = yakshanba
const dom = (s) => Number(s.slice(8, 10));
const localDay = (ts) => iso(new Date(ts));
const localTime = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export async function loadExtra() {
  const [ev, rm, rc] = await Promise.all([
    sb.from('events').select('*').order('starts_at'),
    sb.from('reminders').select('*').order('created_at'),
    sb.from('recurrences').select('*').order('created_at'),
  ]);
  if (!ev.error) S.events = ev.data || [];
  if (!rm.error) S.reminders = rm.data || [];
  if (!rc.error) S.recs = rc.data || [];
}

// ---------- Umumiy shakl oynasi ----------
function form({ title, fields, ok = 'Saqlash', onDelete }) {
  return new Promise((resolve) => {
    const els = {};
    const make = (f) => {
      if (f.type === 'select') { const el = h('select', { class: 'input', id: 'xf_' + f.id }, f.options.map(([v, l]) => h('option', { value: v }, l))); el.value = f.value ?? f.options[0][0]; return el; }
      if (f.type === 'check') return h('input', { type: 'checkbox', id: 'xf_' + f.id, checked: !!f.value });
      if (f.type === 'textarea') return h('textarea', { class: 'input', id: 'xf_' + f.id, value: f.value || '' });
      return h('input', { class: 'input', id: 'xf_' + f.id, type: f.type || 'text', value: f.value ?? '', min: f.min, max: f.max, maxlength: f.type ? null : 200 });
    };
    const rows = {};
    const body = fields.map((f) => {
      els[f.id] = make(f);
      rows[f.id] = f.type === 'check'
        ? h('label', { class: 'check' }, els[f.id], f.label)
        : h('div', { class: 'field' }, h('label', { for: 'xf_' + f.id }, f.label, f.required && h('span', { class: 'req' }, ' *')), els[f.id]);
      return rows[f.id];
    });
    const vals = () => Object.fromEntries(fields.map((f) => [f.id, f.type === 'check' ? els[f.id].checked : els[f.id].value.trim()]));
    const sync = () => { const v = vals(); for (const f of fields) if (f.show) rows[f.id].style.display = f.show(v) ? '' : 'none'; };
    const err = h('div', { class: 'err', role: 'alert' });
    const close = (v) => { ov.remove(); resolve(v); };
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(null); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', style: 'max-height:92vh;overflow-y:auto', onchange: sync },
        h('h2', {}, title), body, err,
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, 'Bekor'),
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const v = vals();
            for (const f of fields) if (f.required && (!f.show || f.show(v)) && !v[f.id]) { err.textContent = `«${f.label}» to'ldirilishi shart`; return; }
            close(v);
          } }, ok)),
        onDelete && h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox({ title: 'O\'chirilsinmi?', ok: 'O\'chirish' })) close({ __delete: true }); } }, 'O\'chirish')));
    document.body.append(ov); sync(); els[fields[0].id].focus();
  });
}
const people = () => S.profiles.map((p) => [p.id, p.id === S.me.id ? 'Men' : p.short_name]);
const REPEAT = { yoq: 'Takrorlanmaydi', kunlik: 'Har kuni', haftalik: 'Har hafta', oylik: 'Har oy' };
const weekdayOpts = HAFTA_T.map((n, i) => [String(i + 1), n]);

// ---------- Taqvim ----------
const C = { mode: 'kun', date: null, who: 'all' };

function eventOn(e, d) {
  const s = localDay(e.starts_at);
  if (s === d) return true;
  if (d < s) return false;
  if (e.repeat === 'haftalik') return wd(s) === wd(d);
  if (e.repeat === 'oylik') return dom(s) === dom(d);
  return false;
}
function reminderOn(r, d) {
  if (!r.active) return false;
  if (r.repeat === 'kunlik') return true;
  if (r.repeat === 'haftalik') return r.weekday === wd(d);
  if (r.repeat === 'oylik') return r.monthday === dom(d);
  return r.remind_at ? localDay(r.remind_at) === d : false;
}
/** Bir kunga tegishli hamma narsa: muddatlar, uchrashuvlar, eslatmalar, takrorlanuvchi topshiriqlar. */
export function dayItems(d) {
  const mine = (id) => C.who === 'all' || id === C.who;
  const out = [];
  for (const t of S.tasks) if (isOpen(t) && t.due_date === d && mine(t.assignee_id))
    out.push({ kind: 'muddat', time: '', title: t.title, sub: `Topshiriq №${t.seq} muddati`, who: t.assignee_id, href: `#/ish/${t.id}` });
  for (const e of S.events) if (eventOn(e, d) && mine(e.owner_id))
    out.push({ kind: 'uchrashuv', time: e.all_day ? '' : localTime(e.starts_at), title: e.title, who: e.owner_id, ev: e,
      sub: [e.all_day ? 'Kun bo\'yi' : localTime(e.starts_at) + (e.ends_at ? '–' + localTime(e.ends_at) : ''), e.location, e.with_whom && 'bilan: ' + e.with_whom, e.repeat !== 'yoq' && REPEAT[e.repeat].toLowerCase()].filter(Boolean).join(' · ') });
  for (const r of S.reminders) if (reminderOn(r, d) && (mine(r.owner_id) || r.for_both))
    out.push({ kind: 'eslatma', time: r.repeat === 'yoq' ? (r.remind_at ? localTime(r.remind_at) : '') : (r.at_time || '').slice(0, 5), title: r.title, who: r.owner_id, sub: 'Eslatma' + (r.for_both ? ' · ikkalamizga' : ''), href: '#/eslatmalar' });
  for (const r of S.recs) if (r.active && r.next_run === d && mine(r.assignee_id))
    out.push({ kind: 'takror', time: '', title: r.title, who: r.assignee_id, sub: 'Takrorlanuvchi topshiriq ochiladi', href: '#/takror' });
  return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}
const TILE = { muddat: ['flag', 'red'], uchrashuv: ['clock', 'blue'], eslatma: ['bell', 'amber'], takror: ['repeat', 'green'] };
const whoCls = (id) => (S.profiles.find((p) => p.id === id)?.kind === 'rahbar' ? 'w-b' : 'w-a');

function ItemRow(it) {
  const [ic, cls] = TILE[it.kind];
  const inner = [h('span', { class: `itile ${cls}` }, icon(ic, 20)),
    h('span', { style: 'flex:1;min-width:0' }, h('b', { class: 't-title', style: 'display:block' }, it.title), h('span', { class: 't-meta' }, `${it.sub} · ${nameOf(it.who, true)}`))];
  return it.ev
    ? h('button', { type: 'button', class: `calrow ${whoCls(it.who)}`, onclick: () => eventForm(it.ev) }, inner)
    : h('a', { href: it.href, class: `calrow ${whoCls(it.who)}` }, inner);
}

async function eventForm(e, date) {
  const editable = !e || e.owner_id === S.me.id || e.created_by === S.me.id;
  if (!editable) { toast('Bu uchrashuvni faqat egasi o\'zgartiradi'); return; }
  const v = await form({ title: e ? 'Uchrashuvni tahrirlash' : 'Yangi uchrashuv', onDelete: !!e, fields: [
    { id: 'title', label: 'Nomi', required: true, value: e?.title },
    { id: 'date', label: 'Sana', type: 'date', required: true, value: e ? localDay(e.starts_at) : date || today() },
    { id: 'all_day', label: 'Kun bo\'yi', type: 'check', value: e?.all_day },
    { id: 'from', label: 'Boshlanishi', type: 'time', value: e && !e.all_day ? localTime(e.starts_at) : '10:00', show: (x) => !x.all_day, required: true },
    { id: 'to', label: 'Tugashi', type: 'time', value: e?.ends_at ? localTime(e.ends_at) : '', show: (x) => !x.all_day },
    { id: 'owner', label: 'Kimning taqvimiga', type: 'select', options: people(), value: e?.owner_id || S.me.id },
    { id: 'location', label: 'Joy', value: e?.location },
    { id: 'with_whom', label: 'Kim bilan', value: e?.with_whom },
    { id: 'repeat', label: 'Takrorlanishi', type: 'select', options: [['yoq', REPEAT.yoq], ['haftalik', REPEAT.haftalik], ['oylik', REPEAT.oylik]], value: e?.repeat || 'yoq' },
    { id: 'notes', label: 'Izoh', type: 'textarea', value: e?.notes },
    { id: 'is_private', label: 'Faqat menga ko\'rinsin', type: 'check', value: e?.is_private },
  ] });
  if (!v) return;
  if (v.__delete) { const { error } = await sb.from('events').delete().eq('id', e.id); if (error) { toast('O\'chirib bo\'lmadi'); return; } await loadExtra(); toast('O\'chirildi'); bus.render(); return; }
  if (!v.all_day && v.to && v.to <= v.from) { toast('Tugash vaqti boshlanishidan keyin bo\'lishi kerak'); return; }
  const at = (t) => new Date(`${v.date}T${t}:00`).toISOString();
  const row = { title: v.title, owner_id: v.owner, starts_at: at(v.all_day ? '00:00' : v.from), ends_at: !v.all_day && v.to ? at(v.to) : null, all_day: v.all_day,
    location: v.location || null, with_whom: v.with_whom || null, notes: v.notes || null, repeat: v.repeat, is_private: v.is_private };
  const { error } = e ? await sb.from('events').update(row).eq('id', e.id) : await sb.from('events').insert({ ...row, created_by: S.me.id });
  if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return; }
  if (!v.is_private) ping(v.owner, 'uchrashuv', e ? 'Uchrashuv o\'zgardi' : 'Yangi uchrashuv', `${v.title} · ${fmtDate(v.date)}`, 'event', null);
  await loadExtra(); C.date = v.date; C.mode = 'kun'; toast('Saqlandi'); bus.render();
}

/** Taqvimda surish: keyingi yoki oldingi kun, hafta yoki oy. */
export function calShift(dir) {
  const d = C.date || today();
  C.date = C.mode === 'kun' ? addDays(d, dir) : C.mode === 'hafta' ? addDays(d, dir * 7) : (dir > 0 ? addDays(monthEnd(d), 1) : monthStart(addDays(monthStart(d), -1)));
  bus.render();
}
export function Calendar() {
  const d = C.date || today();
  const seg = (val, label) => h('button', { type: 'button', class: C.mode === val ? 'on' : '', 'aria-pressed': String(C.mode === val), onclick: () => { C.mode = val; bus.render(); } }, label);
  const who = (val, label) => h('button', { type: 'button', class: 'fchip' + (C.who === val ? ' on' : ''), 'aria-pressed': String(C.who === val), onclick: () => { C.who = val; bus.render(); } }, label);
  const step = C.mode === 'kun' ? 1 : C.mode === 'hafta' ? 7 : 0;
  const move = (dir) => { C.date = step ? addDays(d, dir * step) : (dir > 0 ? addDays(monthEnd(d), 1) : monthStart(addDays(monthStart(d), -1))); bus.render(); };
  const label = C.mode === 'kun' ? fmtDay(d) : C.mode === 'hafta' ? `${fmtDate(mondayOf(d)).slice(0, 5)} – ${fmtDate(addDays(mondayOf(d), 6)).slice(0, 5)}` : monthName(d);

  let body;
  if (C.mode === 'kun') {
    const items = dayItems(d);
    body = items.length ? h('div', { class: 'callist' }, items.map(ItemRow)) : Empty('Bu kun bo\'sh', 'Muddat, uchrashuv yoki eslatma yo\'q.');
  } else if (C.mode === 'hafta') {
    const start = mondayOf(d);
    body = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
      const items = dayItems(day);
      return h('section', { class: 'card', style: 'gap:6px' },
        h('button', { type: 'button', class: 'dayhead', onclick: () => { C.date = day; C.mode = 'kun'; bus.render(); } },
          h('b', { class: day === today() ? 'c-brand' : '' }, fmtDay(day)), h('span', { class: 't-meta' }, items.length ? `${items.length} ta` : 'bo\'sh')),
        items.length ? h('div', { class: 'callist flat' }, items.map(ItemRow)) : null);
    });
  } else {
    const first = monthStart(d), last = monthEnd(d), pad = wd(first) - 1, n = dom(last);
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(h('span', {}));
    for (let i = 1; i <= n; i++) {
      const day = first.slice(0, 8) + String(i).padStart(2, '0'), items = dayItems(day);
      const kinds = [...new Set(items.map((x) => TILE[x.kind][1]))];
      cells.push(h('button', { type: 'button', class: 'mcell' + (day === today() ? ' today' : ''), 'aria-label': `${fmtDay(day)}, ${items.length} ta`, onclick: () => { C.date = day; C.mode = 'kun'; bus.render(); } },
        h('b', {}, i), h('span', { class: 'dots' }, kinds.map((k) => h('i', { class: 'd-' + k })))));
    }
    body = [h('section', { class: 'card' }, h('div', { class: 'mgrid head7' }, HAFTA_Q.map((x) => h('span', {}, x))), h('div', { class: 'mgrid' }, cells)),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'd-red' }), 'Muddat'), h('span', {}, h('i', { class: 'd-blue' }), 'Uchrashuv'), h('span', {}, h('i', { class: 'd-amber' }), 'Eslatma'), h('span', {}, h('i', { class: 'd-green' }), 'Takroriy'))];
  }
  return h('main', { class: 'view' },
    Head('Muddatlar, uchrashuvlar, eslatmalar', 'Taqvim'),
    h('div', { class: 'seg' }, seg('kun', 'Kun'), seg('hafta', 'Hafta'), seg('oy', 'Oy')),
    h('div', { class: 'between' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Oldingi', onclick: () => move(-1) }, icon('back', 20)),
      h('button', { type: 'button', class: 'datelabel', onclick: () => { C.date = today(); bus.render(); } }, h('b', {}, label), d !== today() && h('span', { class: 't-meta' }, 'Bugunga qaytish')),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Keyingi', onclick: () => move(1) }, icon('next', 20))),
    h('div', { class: 'filters' }, who('all', 'Ikkalamiz'), S.profiles.map((p) => who(p.id, p.id === S.me.id ? 'Men' : p.short_name))),
    body,
    h('button', { class: 'fab', type: 'button', 'aria-label': 'Uchrashuv qo\'shish', style: 'border:none;cursor:pointer', onclick: () => eventForm(null, d) }, icon('plus', 26, '#fff', 2.4)));
}

// ---------- Eslatmalar ----------
function reminderText(r) {
  const t = (r.at_time || '').slice(0, 5);
  if (r.repeat === 'kunlik') return `Har kuni ${t}`;
  if (r.repeat === 'haftalik') return `Har ${HAFTA_T[(r.weekday || 1) - 1].toLowerCase()} ${t}`;
  if (r.repeat === 'oylik') return `Har oyning ${r.monthday}-kuni ${t}`;
  return r.remind_at ? `${fmtDate(localDay(r.remind_at))} ${localTime(r.remind_at)}` : '—';
}
async function reminderForm(r) {
  const v = await form({ title: r ? 'Eslatmani tahrirlash' : 'Yangi eslatma', onDelete: !!r, fields: [
    { id: 'title', label: 'Nimani eslatish', required: true, value: r?.title },
    { id: 'repeat', label: 'Takrorlanishi', type: 'select', options: Object.entries(REPEAT), value: r?.repeat || 'yoq' },
    { id: 'date', label: 'Sana', type: 'date', required: true, value: r?.remind_at ? localDay(r.remind_at) : today(), show: (x) => x.repeat === 'yoq' },
    { id: 'weekday', label: 'Hafta kuni', type: 'select', options: weekdayOpts, value: String(r?.weekday || wd(today())), show: (x) => x.repeat === 'haftalik' },
    { id: 'monthday', label: 'Oyning nechanchi kuni', type: 'number', min: 1, max: 31, required: true, value: r?.monthday || dom(today()), show: (x) => x.repeat === 'oylik' },
    { id: 'time', label: 'Vaqt', type: 'time', required: true, value: r ? (r.repeat === 'yoq' && r.remind_at ? localTime(r.remind_at) : (r.at_time || '09:00').slice(0, 5)) : '09:00' },
    { id: 'for_both', label: 'Ikkalamizga eslatilsin', type: 'check', value: r?.for_both },
    { id: 'is_private', label: 'Faqat menga ko\'rinsin', type: 'check', value: r?.is_private },
  ] });
  if (!v) return;
  if (v.__delete) { const { error } = await sb.from('reminders').delete().eq('id', r.id); if (error) { toast('O\'chirib bo\'lmadi'); return; } await loadExtra(); bus.render(); return; }
  const md = Number(v.monthday);
  if (v.repeat === 'oylik' && !(md >= 1 && md <= 31)) { toast('Oy kuni 1 dan 31 gacha bo\'lishi kerak'); return; }
  const row = { title: v.title, repeat: v.repeat, at_time: v.time, for_both: v.for_both && !v.is_private, is_private: v.is_private,
    remind_at: v.repeat === 'yoq' ? new Date(`${v.date}T${v.time}:00`).toISOString() : null,
    weekday: v.repeat === 'haftalik' ? Number(v.weekday) : null, monthday: v.repeat === 'oylik' ? md : null };
  const { error } = r ? await sb.from('reminders').update(row).eq('id', r.id) : await sb.from('reminders').insert({ ...row, owner_id: S.me.id, active: true });
  if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return; }
  await loadExtra(); toast('Saqlandi'); bus.render();
}
export function Reminders() {
  const card = (r) => {
    const mine = r.owner_id === S.me.id;
    return h('article', { class: 'card', style: 'flex-direction:row;align-items:center;gap:12px' },
      h('span', { class: 'itile amber' }, icon('bell', 20)),
      h(mine ? 'button' : 'div', { type: mine ? 'button' : null, class: 'plainbtn', style: 'flex:1;min-width:0', onclick: mine ? () => reminderForm(r) : null },
        h('b', { class: 't-title', style: `display:block;${r.active ? '' : 'color:var(--muted)'}` }, r.title),
        h('span', { class: 't-meta' }, [reminderText(r), nameOf(r.owner_id, true), r.for_both && 'ikkalamizga', r.is_private && 'shaxsiy', !r.active && 'o\'chirilgan'].filter(Boolean).join(' · '))),
      mine && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.active, 'aria-label': `«${r.title}» yoqilgan`, onchange: async (e) => {
        const { error } = await sb.from('reminders').update({ active: e.target.checked }).eq('id', r.id);
        if (error) toast('Saqlab bo\'lmadi'); await loadExtra(); bus.render();
      } })));
  };
  return h('main', { class: 'view' },
    BackHead('Eslatmalar', '#/yana'),
    h('div', { class: 'banner' }, 'Eslatmalar taqvimda ko\'rinadi. Telefonga bildirishnoma bo\'lib kelishi dastur APK qilib o\'rnatilgandan keyin ishlaydi.'),
    S.reminders.length ? S.reminders.map(card) : Empty('Eslatma yo\'q', 'Birinchisini qo\'shing.'),
    h('button', { class: 'btn', type: 'button', onclick: () => reminderForm(null) }, '+ Eslatma qo\'shish'));
}

// ---------- Takrorlanuvchi topshiriqlar ----------
function nextRun(r, from) {
  if (r.freq === 'kunlik') return addDays(from, 1);
  if (r.freq === 'haftalik') return addDays(from, 7);
  const d = new Date(from.slice(0, 8) + '01T12:00:00'); d.setMonth(d.getMonth() + 1);
  const first = iso(d), last = dom(monthEnd(first));
  return first.slice(0, 8) + String(Math.min(r.monthday || dom(from), last)).padStart(2, '0');
}
/** Vaqti kelgan takrorlanuvchi topshiriqlarni ochadi. Har bir takrorni faqat uni yaratgan kishining qurilmasi ochadi. */
export async function runRecurrences() {
  let made = 0;
  for (const r of S.recs) {
    if (!r.active || r.creator_id !== S.me.id) continue;
    let run = r.next_run, guard = 0;
    while (run <= today() && guard++ < 40) {
      const nxt = nextRun(r, run);
      // Avval navbatni suramiz: ikki qurilma bir vaqtda ochsa ham topshiriq ikki marta yaratilmaydi
      const { data, error } = await sb.from('recurrences').update({ next_run: nxt }).eq('id', r.id).eq('next_run', run).select();
      if (error || !data || !data.length) break;
      const { error: e2 } = await sb.from('tasks').insert({ title: r.title, description: r.description, purpose: r.purpose, level: r.level, creator_id: r.creator_id, assignee_id: r.assignee_id,
        due_date: addDays(run, r.due_offset_days || 0), recurrence_id: r.id, is_private: r.is_private });
      if (!e2) { made++; ping(r.assignee_id, 'topshiriq', 'Takrorlanuvchi topshiriq ochildi', r.title, 'task', null); }
      run = nxt;
    }
  }
  if (made) { await Promise.all([loadTasks(), loadExtra()]); toast(`${made} ta takrorlanuvchi topshiriq ochildi`); }
  return made;
}
function recText(r) {
  const f = r.freq === 'kunlik' ? 'Har kuni' : r.freq === 'haftalik' ? `Har ${HAFTA_T[(r.weekday || 1) - 1].toLowerCase()}` : `Har oyning ${r.monthday}-kuni`;
  return `${f} · muddat ${r.due_offset_days || 0} kun · keyingisi ${fmtDate(r.next_run)}`;
}
async function recForm(r) {
  const v = await form({ title: r ? 'Takrorni tahrirlash' : 'Yangi takrorlanuvchi topshiriq', fields: [
    { id: 'title', label: 'Topshiriq nomi', required: true, value: r?.title },
    { id: 'assignee', label: 'Kimga', type: 'select', options: people(), value: r?.assignee_id || S.me.id },
    { id: 'freq', label: 'Qanchalik tez-tez', type: 'select', options: [['kunlik', 'Har kuni'], ['haftalik', 'Har hafta'], ['oylik', 'Har oy']], value: r?.freq || 'haftalik' },
    { id: 'weekday', label: 'Hafta kuni', type: 'select', options: weekdayOpts, value: String(r?.weekday || 1), show: (x) => x.freq === 'haftalik' },
    { id: 'monthday', label: 'Oyning nechanchi kuni', type: 'number', min: 1, max: 31, required: true, value: r?.monthday || 1, show: (x) => x.freq === 'oylik' },
    { id: 'offset', label: 'Bajarish uchun necha kun beriladi', type: 'number', min: 0, max: 60, required: true, value: r?.due_offset_days ?? 1 },
    { id: 'description', label: 'Izoh', type: 'textarea', value: r?.description },
    { id: 'is_private', label: 'Faqat menga ko\'rinsin', type: 'check', value: r?.is_private },
  ] });
  if (!v) return;
  const md = Number(v.monthday), off = Number(v.offset);
  if (v.freq === 'oylik' && !(md >= 1 && md <= 31)) { toast('Oy kuni 1 dan 31 gacha bo\'lishi kerak'); return; }
  if (!(off >= 0 && off <= 60)) { toast('Muddat 0 dan 60 kungacha bo\'lishi kerak'); return; }
  // Birinchi ochilish kuni: bugundan boshlab mos keladigan eng yaqin kun
  let first = today();
  if (v.freq === 'haftalik') while (wd(first) !== Number(v.weekday)) first = addDays(first, 1);
  if (v.freq === 'oylik') { let g = 0; while (dom(first) !== Math.min(md, dom(monthEnd(first))) && g++ < 62) first = addDays(first, 1); }
  const row = { title: v.title, assignee_id: v.assignee, freq: v.freq, weekday: v.freq === 'haftalik' ? Number(v.weekday) : null, monthday: v.freq === 'oylik' ? md : null,
    due_offset_days: off, description: v.description || null, is_private: v.is_private };
  const changed = !r || r.freq !== v.freq || r.weekday !== row.weekday || r.monthday !== row.monthday;
  const { error } = r ? await sb.from('recurrences').update(changed ? { ...row, next_run: first } : row).eq('id', r.id)
    : await sb.from('recurrences').insert({ ...row, creator_id: S.me.id, next_run: first, active: true });
  if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return; }
  await loadExtra(); await runRecurrences(); toast('Saqlandi'); bus.render();
}
export function Recurrences() {
  const card = (r) => {
    const mine = r.creator_id === S.me.id;
    return h('article', { class: 'card', style: 'flex-direction:row;align-items:center;gap:12px' },
      h('span', { class: 'itile green' }, icon('repeat', 20)),
      h(mine ? 'button' : 'div', { type: mine ? 'button' : null, class: 'plainbtn', style: 'flex:1;min-width:0', onclick: mine ? () => recForm(r) : null },
        h('b', { class: 't-title', style: `display:block;${r.active ? '' : 'color:var(--muted)'}` }, r.title),
        h('span', { class: 't-meta' }, `${r.active ? recText(r) : 'To\'xtatilgan'} · ${nameOf(r.creator_id, true)} → ${nameOf(r.assignee_id, true)}`)),
      mine && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.active, 'aria-label': `«${r.title}» yoqilgan`, onchange: async (e) => {
        const { error } = await sb.from('recurrences').update({ active: e.target.checked }).eq('id', r.id);
        if (error) toast('Saqlab bo\'lmadi'); await loadExtra(); bus.render();
      } })));
  };
  return h('main', { class: 'view' },
    BackHead('Takrorlanuvchi topshiriqlar', '#/yana'),
    h('div', { class: 't-meta', style: 'padding:0 4px' }, 'Belgilangan kuni topshiriq o\'zi ochiladi. To\'xtatish uchun belgini olib tashlang; ochilgan topshiriqlar o\'chmaydi.'),
    S.recs.length ? S.recs.map(card) : Empty('Takrorlanuvchi topshiriq yo\'q', 'Masalan: har shanba haftalik hisobot.'),
    h('button', { class: 'btn', type: 'button', onclick: () => recForm(null) }, '+ Takror qo\'shish'));
}

// ---------- Admin panel ----------
export function Admin() {
  if (!S.me.is_admin) return h('main', { class: 'view' }, BackHead('Admin panel', '#/yana'), Empty('Ruxsat yo\'q', 'Bu bo\'lim faqat admin uchun.'));
  const s = S.settings, el = {};
  const num = (id, label, val, min, max) => { el[id] = h('input', { class: 'input', id: 'ad_' + id, type: 'number', min, max, value: val }); return h('div', { class: 'field' }, h('label', { for: 'ad_' + id }, label), el[id]); };
  const tim = (id, label, val) => { el[id] = h('input', { class: 'input', id: 'ad_' + id, type: 'time', value: val }); return h('div', { class: 'field' }, h('label', { for: 'ad_' + id }, label), el[id]); };
  const m = s.muhimlik || {}, e = s.eslatma || {}, hs = s.hisobot || {}, mq = s.maqsad || {};
  const err = h('div', { class: 'err', role: 'alert' });
  const save = async () => {
    const n = (id) => Number(el[id].value);
    err.textContent = '';
    if (!(n('muhim') >= 0 && n('ortacha') > n('muhim'))) { err.textContent = '«O\'rtacha» chegarasi «Muhim!» chegarasidan katta bo\'lishi kerak'; return; }
    for (const id of ['javob', 'savat', 'vaqtida', 'intizom']) if (!(n(id) >= 1)) { err.textContent = 'Sonlar 1 dan kichik bo\'lmasligi kerak'; return; }
    if (n('vaqtida') > 100 || n('intizom') > 100) { err.textContent = 'Foiz 100 dan oshmaydi'; return; }
    for (const id of ['reja', 'tuzish', 'hisobot', 'kunlik']) if (!el[id].value) { err.textContent = 'Vaqtlarning hammasi to\'ldirilishi kerak'; return; }
    const rows = [
      ['muhimlik', { ...m, muhim_kun: n('muhim'), ortacha_kun: n('ortacha') }],
      ['eslatma', { ...e, javob_soat: n('javob'), kunlik_eslatma_vaqti: el.kunlik.value }],
      ['hisobot', { ...hs, reja_vaqti: el.reja.value, hisobot_tuzish: el.tuzish.value, hisobot_vaqti: el.hisobot.value }],
      ['maqsad', { ...mq, vaqtida_foiz: n('vaqtida'), intizom_foiz: n('intizom') }],
      ['savat_kun', n('savat')],
    ];
    for (const [key, value] of rows) {
      const { error } = await sb.from('app_settings').update({ value, updated_by: S.me.id }).eq('key', key);
      if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return; }
    }
    await loadBase(); toast('Sozlamalar saqlandi'); bus.render();
  };
  const rename = async (p) => {
    const v = await form({ title: 'Ismni o\'zgartirish', fields: [
      { id: 'full', label: 'To\'liq ism', required: true, value: p.full_name }, { id: 'short', label: 'Dasturda ko\'rinadigan ism', required: true, value: p.short_name }] });
    if (!v) return;
    const { error } = await sb.from('profiles').update({ full_name: v.full, short_name: v.short }).eq('id', p.id);
    if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return; }
    await loadBase(); toast('Saqlandi'); bus.render();
  };
  return h('main', { class: 'view' },
    BackHead('Admin panel', '#/yana'),
    h('div', { class: 'section' }, h('h2', {}, 'Muhimlik')),
    h('section', { class: 'card' },
      num('muhim', '«Muhim!»: muddatga necha kun qolganda', m.muhim_kun ?? 3, 0, 60),
      num('ortacha', '«O\'rtacha»: necha kungacha (undan keyin «Muhim emas»)', m.ortacha_kun ?? 10, 1, 120)),
    h('div', { class: 'section' }, h('h2', {}, 'Reja va hisobot vaqtlari')),
    h('section', { class: 'card' },
      tim('reja', 'Kunlik reja ko\'rinadigan vaqt', hs.reja_vaqti || '07:30'),
      tim('tuzish', 'Kechki hisobot tuziladigan vaqt', hs.hisobot_tuzish || '19:00'),
      tim('hisobot', 'Kechki hisobot yuborilishi kerak bo\'lgan vaqt', hs.hisobot_vaqti || '19:30')),
    h('div', { class: 'section' }, h('h2', {}, 'Eslatmalar')),
    h('section', { class: 'card' },
      num('javob', 'Tasdiqqa javob bo\'lmasa necha soatdan keyin eslatilsin', e.javob_soat ?? 1, 1, 48),
      tim('kunlik', 'Ertalabki eslatma vaqti', e.kunlik_eslatma_vaqti || '08:00')),
    h('div', { class: 'section' }, h('h2', {}, 'Maqsadlar va saqlash')),
    h('section', { class: 'card' },
      num('vaqtida', 'Vaqtida bajarish maqsadi, %', mq.vaqtida_foiz ?? 90, 1, 100),
      num('intizom', 'Hisobot intizomi maqsadi, %', mq.intizom_foiz ?? 100, 1, 100),
      num('savat', 'Savatda necha kun saqlansin', s.savat_kun ?? 30, 1, 365)),
    err,
    h('button', { class: 'btn', type: 'button', onclick: save }, 'Sozlamalarni saqlash'),
    h('div', { class: 'section' }, h('h2', {}, 'Foydalanuvchilar')),
    h('div', { class: 'list' }, S.profiles.map((p) => h('button', { type: 'button', onclick: () => rename(p) },
      h('span', {}, h('b', {}, p.full_name), h('small', {}, `${p.kind === 'rahbar' ? 'Rahbar' : 'Yordamchi'}${p.is_admin ? ' · admin' : ''} · ko'rinishi: ${p.short_name}`)), icon('next', 18, '#56645F')))),
    h('div', { class: 't-meta', style: 'padding:0 4px' }, 'Eslatma vaqtlari telefonga bildirishnoma ulangandan keyin kuchga kiradi. Muhimlik va maqsadlar darhol ishlaydi.'));
}

// ---------- Kimdan kutilmoqda ----------
export function WaitingOn() {
  const open = S.tasks.filter((t) => isOpen(t) && t.waiting_on);
  const groups = S.contacts.map((c) => ({ c, tasks: open.filter((t) => t.waiting_on === c.id).sort((a, b) => a.due_date.localeCompare(b.due_date)) }))
    .filter((g) => g.tasks.length).sort((a, b) => a.tasks[0].due_date.localeCompare(b.tasks[0].due_date));
  return h('main', { class: 'view' },
    BackHead('Kimdan kutilmoqda', '#/yana'),
    h('div', { class: 't-meta', style: 'padding:0 4px' }, 'Uchinchi shaxsdan javob yoki ish kutilayotgan ochiq topshiriqlar. Ism topshiriqni yaratish yoki tahrirlashda «Kimdan kutilmoqda» maydoniga yoziladi.'),
    groups.length ? groups.map((g) => [
      h('div', { class: 'section' }, h('h2', {}, g.c.name), h('span', { class: 't-meta' }, `${g.tasks.length} ta`)),
      g.tasks.map(TaskCard)]) : Empty('Hech kimdan kutilmayapti', 'Ochiq topshiriqlarda «Kimdan kutilmoqda» to\'ldirilmagan.'));
}
