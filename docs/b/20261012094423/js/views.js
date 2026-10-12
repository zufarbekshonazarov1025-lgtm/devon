import { sb, S, bus, h, icon, toast, ask, confirmBox, today, fmtDate, fmtDateTime, dayOf, daysLeft, longToday, greeting,
  celebrate, STATUS, isOpen, priority, dueChip, onTime, onTimeStats, nameOf, other, profile, loadTasks, updateTask, notify, go, Head, BackHead, Empty, owner } from './core.js';
import { Files } from './files.js';
import { unregisterDevice } from './native.js';
import { Bell, HomeKudos, StreakChip, KudosBlock, downloadExcel } from './more.js';
import { pendingReminders, PendingReminderCard, pendingDueTasks, DueSummaryCard } from './extra.js';
import { HomePlan, RequestCard, pendingForMe, mySentRequests, askDecision, askReschedule, SentCard } from './plan.js';

export function TaskCard(t) {
  const pr = priority(t), du = dueChip(t);
  const closed = !isOpen(t);
  return h('a', { class: 'card', href: `#/ish/${t.id}` },
    h('div', { class: 'between' },
      pr ? h('span', { class: `chip ${pr.cls}` }, pr.label)
        : h('span', { class: `chip ${t.status === 'bajarildi' ? 'green' : 'grey'}` }, STATUS[t.status]),
      du ? h('span', { class: `chip ${du.cls}` }, du.label)
        : closed && t.status === 'bajarildi' && onTime(t) !== null
          ? h('span', { class: `chip ${onTime(t) ? 'green' : 'amber'}` }, onTime(t) ? 'Vaqtida' : 'Kechikib')
          : null),
    h('div', { class: 't-title' }, t.title),
    h('div', { class: 't-meta' },
      `${nameOf(t.creator_id, true)} → ${nameOf(t.assignee_id, true)} · ${STATUS[t.status]} · muddat ${fmtDate(t.due_date)}`,
      t.is_private ? ' · shaxsiy' : ''),
    isOpen(t) && t.waiting_on && S.contacts.find((c) => c.id === t.waiting_on)
      ? h('div', { class: 't-meta', style: 'font-weight:700;color:var(--amber)' }, `Kutilmoqda: ${S.contacts.find((c) => c.id === t.waiting_on).name}`) : null);
}
/** «Kutilmoqda» holatiga o'tkazishda kimdan kutilayotgani so'raladi. */
async function setWaiting(t) {
  const cur = (S.contacts.find((c) => c.id === t.waiting_on) || {}).name || '';
  const name = await ask({ title: 'Kimdan kutilmoqda?', label: 'Ism (masalan: Jamshidbek)', value: cur, ok: 'Saqlash' });
  if (name == null) return;
  let c = S.contacts.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!c) { const { data, error } = await sb.from('contacts').insert({ name: name.trim(), created_by: S.me.id }).select().single(); if (error) { toast('Saqlab bo\'lmadi'); return; } c = data; S.contacts.push(c); }
  updateTask(t.id, { status: 'kutilmoqda', waiting_on: c.id }, `Kutilmoqda: ${c.name}`);
}

/** Mendan javob kutayotgan ishlar. */
export function needsMe() {
  const me = S.me.id;
  return S.tasks.filter((t) =>
    (t.status === 'tekshiruvda' && t.creator_id === me && t.assignee_id !== me) ||
    (isOpen(t) && t.assignee_id === me && t.creator_id !== me && !t.accepted_at));
}
const byDue = (a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq;

// ---------- Kirish ----------
export function Login() {
  const email = h('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true });
  const pass = h('input', { class: 'input', id: 'pass', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'err' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Kirish');
  return h('main', { class: 'view noNav' },
    h('form', { class: 'login', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      btn.disabled = false;
      if (error) err.textContent = error.message.includes('Invalid') ? 'Email yoki parol noto\'g\'ri' : 'Kirib bo\'lmadi: ' + error.message;
    } },
      h('img', { src: 'icon.svg', alt: '' }),
      h('h1', {}, 'Devon'),
      h('p', {}, 'Ish Bismillah dan boshlanadi.'),
      h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
      h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Parol'), pass),
      err, btn));
}

export function NoProfile() {
  return h('main', { class: 'view noNav' }, h('div', { class: 'login' },
    h('h1', {}, 'Devon'),
    h('p', {}, 'Bu hisob dasturga qo\'shilmagan. Admin bilan bog\'laning.'),
    h('button', { class: 'btn ghost', onclick: () => sb.auth.signOut() }, 'Chiqish')));
}

// ---------- Bugun ----------
export function Home() {
  const me = S.me, ot = other(), d = longToday();
  const mine = S.tasks.filter((t) => isOpen(t) && t.assignee_id === me.id).sort(byDue);
  const theirs = ot ? S.tasks.filter((t) => isOpen(t) && t.assignee_id === ot.id).sort(byDue) : [];
  const waiting = needsMe().sort(byDue);
  const open = S.tasks.filter(isOpen);
  const done = S.tasks.filter((t) => t.status === 'bajarildi');
  const st = onTimeStats(me.kind === 'rahbar' ? S.tasks : S.tasks.filter((t) => t.assignee_id === me.id));
  const pct = st.pct == null ? '—' : st.pct + '%';
  const motto = typeof S.settings.shior === 'string' ? S.settings.shior : '';

  const tiles = me.kind === 'rahbar'
    ? [[S.tasks.length, 'Jami', '', 'all', 'all'], [done.length, 'Bajarildi', 'c-brand', 'done', 'all'], [open.length, 'Ochiq', '', 'open', 'all'], [pct, 'Vaqtida', 'c-brand', 'ontime', 'all']]
    : [[mine.length, 'Ochiq', '', 'open', 'me'], [mine.filter((t) => priority(t)?.key === 'muhim').length, 'Muhim!', 'c-red', 'muhim', 'me'],
       [S.tasks.filter((t) => t.status === 'tekshiruvda' && t.assignee_id === me.id).length, 'Javob kutadi', 'c-amber', 'review', 'me'], [pct, 'Vaqtida', 'c-brand', 'ontime', 'me']];

  // Shu kunga tegishli hamma ish bajarilgan bo'lsa
  const dueToday = S.tasks.filter((t) => t.assignee_id === me.id && t.due_date === today() && t.status !== 'bekor');
  const planToday = S.plan.filter((i) => (i.for_id || i.owner_id) === me.id && i.plan_date === today());
  const barokat = dueToday.length + planToday.length > 0 && dueToday.every((t) => !isOpen(t) || t.status === 'tekshiruvda') && planToday.every((i) => i.done);

  // Kuniga bir marta tabriklaymiz
  if (barokat) { try { const k = 'devon_barokat_' + me.id; if (localStorage.getItem(k) !== today()) { localStorage.setItem(k, today()); setTimeout(() => celebrate('barokat'), 300); } } catch (e) { /* xotira yopiq bo'lsa tabriksiz */ } }
  const reqs = pendingForMe(), rems = pendingReminders(), dues = pendingDueTasks();
  const waitingBlock = waiting.length + reqs.length + rems.length + dues.length ? [
    h('div', { class: 'section' }, h('h2', {}, 'Sizdan javob kutmoqda'), h('span', { class: 'chip red' }, waiting.length + reqs.length + rems.length + (dues.length ? 1 : 0))),
    dues.length ? DueSummaryCard(dues) : null,
    rems.map(PendingReminderCard),
    reqs.map((r) => RequestCard(r)),
    waiting.map((t) => WaitCard(t)),
  ] : [];
  const mineBlock = [
    h('div', { class: 'section' }, h('h2', {}, 'Muddati yaqin ishlarim'), h('a', { href: '#/ishlar' }, 'Hammasi')),
    mine.length ? mine.slice(0, 4).map(TaskCard) : Empty('Bugunga hammasi tayyor', 'Sizga biriktirilgan ochiq ish yo\'q.'),
  ];
  const theirsBlock = ot ? [
    h('div', { class: 'section' }, h('h2', {}, me.kind === 'rahbar' ? `${nameOf(ot.id, true)} hozir nima ustida` : `${nameOf(ot.id, true)}dagi ishlar`), h('a', { href: '#/ishlar' }, 'Hammasi')),
    theirs.length ? theirs.slice(0, 4).map(TaskCard) : Empty('Ochiq ish yo\'q', `${nameOf(ot.id, true)}ga biriktirilgan ochiq ish yo'q.`),
  ] : [];

  return h('main', { class: 'view' },
    Head(`${d.week} · ${greeting()}, ${me.short_name}`, d.day,
      h('div', { style: 'display:flex;gap:8px' }, Bell(), h('button', { class: 'iconbtn', 'aria-label': 'Qidiruv', onclick: () => go('#/ishlar') }, icon('search', 20)))),
    motto && h('div', { class: 'motto' }, motto),
    me.id === owner().id && StreakChip(),
    HomeKudos(),
    h('div', { class: 'tiles' }, tiles.map(([n, l, c, show, who]) => h('button', { class: 'tile', type: 'button', 'aria-label': `${l}: ${n}. Ro'yxatni ochish`,
      onclick: () => { F.show = show; F.who = who; F.q = ''; go('#/ishlar'); } }, h('b', { class: c }, n), h('span', {}, l)))),
    barokat && h('div', { class: 'banner gold' }, 'Barokatli kun bo\'ldi'),
    me.kind === 'rahbar' ? [waitingBlock, HomePlan(), theirsBlock, mineBlock] : [waitingBlock, HomePlan(), mineBlock, theirsBlock],
    h('a', { class: 'fab', href: '#/ishlar/yangi', 'aria-label': 'Yangi topshiriq' }, icon('plus', 24, '#fff', 2.5)));
}

function WaitCard(t) {
  const review = t.status === 'tekshiruvda';
  return h('article', { class: 'card' },
    h('div', {},
      h('div', { class: 't-meta c-amber', style: 'font-weight:700' }, review ? 'Bajarildi · tekshiruv kutmoqda' : 'Yangi topshiriq · qabul qilish kerak'),
      h('a', { class: 't-title', href: `#/ish/${t.id}`, style: 'color:inherit;display:block;margin-top:4px' }, t.title),
      h('div', { class: 't-meta', style: 'margin-top:4px' }, review ? `${nameOf(t.assignee_id, true)} yubordi · ${fmtDateTime(t.submitted_at)}` : `${nameOf(t.creator_id, true)} berdi · muddat ${fmtDate(t.due_date)}`)),
    review && t.result && h('div', { class: 'text t-meta', style: 'color:var(--ink)' }, t.result),
    review
      ? h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => acceptResult(t) }, 'Qabul qilish'),
          h('button', { class: 'btn ghost', onclick: () => returnTask(t) }, 'Qaytarish'))
      : h('button', { class: 'btn', onclick: () => acceptTask(t) }, 'Qabul qildim'));
}

// ---------- Amallar ----------
async function acceptTask(t) {
  if (await updateTask(t.id, { accepted_at: new Date().toISOString() }, 'Qabul qilindi'))
    notify(t.creator_id, 'qabul', 'Topshiriq qabul qilindi', t.title, t.id);
}
async function submitTask(t) {
  const result = await ask({ title: 'Natijani yozing', label: 'Nima qilindi, qanday yakunlandi', ok: 'Bajarildi' });
  if (result == null) return;
  const now = new Date().toISOString();
  const self = t.creator_id === t.assignee_id;
  const patch = { result, submitted_at: now, status: self ? 'bajarildi' : 'tekshiruvda', closed_at: self ? now : null };
  if (!t.accepted_at) patch.accepted_at = now;
  if (await updateTask(t.id, patch, self ? null : 'Tekshiruvga yuborildi')) {
    celebrate('done');
    notify(t.creator_id, 'tekshiruv', 'Topshiriq bajarildi, tekshiring', t.title, t.id);
  }
}
async function acceptResult(t) {
  if (await updateTask(t.id, { status: 'bajarildi', closed_at: new Date().toISOString() }, 'Qabul qilindi, tarixga o\'tdi'))
    notify(t.assignee_id, 'qabul', 'Ishingiz qabul qilindi', t.title, t.id);
}
async function returnTask(t) {
  const reason = await ask({ title: 'Qaytarish sababi', label: 'Nimani tuzatish kerak', ok: 'Qaytarish' });
  if (reason == null) return;
  await sb.from('task_comments').insert({ task_id: t.id, author_id: S.me.id, body: 'Qaytarildi: ' + reason });
  if (await updateTask(t.id, { status: 'jarayonda', submitted_at: null, returned_count: (t.returned_count || 0) + 1 }, 'Qaytarildi'))
    notify(t.assignee_id, 'qaytarildi', 'Topshiriq qaytarildi', reason, t.id);
}

// ---------- Ishlar ro'yxati ----------
const F = { who: 'all', show: 'open', q: '' };
const VIEWS = {
  open: { title: 'Ishlar', sub: 'Ochiq, muddati yaqini tepada', test: (t) => isOpen(t) },
  all: { title: 'Jami', sub: 'Hamma topshiriqlar', test: () => true },
  done: { title: 'Bajarildi', sub: 'Bajarilgan topshiriqlar', test: (t) => t.status === 'bajarildi' },
  ontime: { title: 'Vaqtida', sub: 'Vaqtida bajarilganlar', test: (t) => t.status === 'bajarildi' && onTime(t) === true },
  late: { title: 'Kechikib', sub: 'Kechikib bajarilganlar', test: (t) => t.status === 'bajarildi' && onTime(t) === false },
  muhim: { title: 'Muhim!', sub: 'Muddati 3 kungacha yoki o\'tgan', test: (t) => priority(t)?.key === 'muhim' },
  review: { title: 'Tekshiruvda', sub: 'Javob kutayotganlar', test: (t) => t.status === 'tekshiruvda' },
  closed: { title: 'Tarix', sub: 'Yopilgan topshiriqlar', test: (t) => !isOpen(t) },
};
export function Tasks() {
  const ot = other(), me = S.me.id;
  const q = F.q.trim().toLowerCase();
  const V = VIEWS[F.show] || VIEWS.open;
  let rows = S.tasks.filter(V.test);
  if (F.who === 'me') rows = rows.filter((t) => t.assignee_id === me);
  if (F.who === 'ot' && ot) rows = rows.filter((t) => t.assignee_id === ot.id);
  if (F.who === 'wait') rows = rows.filter((t) => t.status === 'kutilmoqda' || t.status === 'tekshiruvda');
  if (q) rows = rows.filter((t) => [t.title, t.description, t.result, t.purpose].some((x) => (x || '').toLowerCase().includes(q)));
  const byClosed = (a, b) => (b.closed_at || b.updated_at).localeCompare(a.closed_at || a.updated_at);
  rows.sort((a, b) => (isOpen(a) !== isOpen(b) ? (isOpen(a) ? -1 : 1) : isOpen(a) ? byDue(a, b) : byClosed(a, b)));

  const chip = (key, val, label) => h('button', { class: 'fchip' + (F[key] === val ? ' on' : ''), type: 'button', 'aria-pressed': String(F[key] === val), onclick: () => { F[key] = val; bus.render(); } }, label);
  const input = h('input', { type: 'search', placeholder: 'Qidirish', 'aria-label': 'Topshiriq qidirish', value: F.q,
    oninput: (e) => { F.q = e.target.value; clearTimeout(input._t); input._t = setTimeout(() => { bus.render(); const el = document.querySelector('.search input'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); } });

  return h('main', { class: 'view' },
    Head(`${V.sub} · ${rows.length} ta`, V.title,
      h('a', { class: 'btn pill small', href: '#/ishlar/yangi' }, '+ Yangi')),
    h('label', { class: 'search' }, icon('search', 18, '#56645F'), input),
    h('div', { class: 'filters' },
      chip('who', 'all', 'Hammasi'), chip('who', 'me', 'Menga'), ot && chip('who', 'ot', nameOf(ot.id, true) + 'ga'), chip('who', 'wait', 'Kutilmoqda'),
      h('span', { 'aria-hidden': 'true', style: 'flex:none;width:1px;background:var(--line);margin:8px 2px' }),
      chip('show', 'open', 'Ochiq'), chip('show', 'all', 'Jami'), chip('show', 'done', 'Bajarildi'), chip('show', 'ontime', 'Vaqtida'),
      chip('show', 'late', 'Kechikib'), chip('show', 'muhim', 'Muhim!'), chip('show', 'review', 'Tekshiruvda'), chip('show', 'closed', 'Tarix')),
    rows.length ? rows.map(TaskCard) : Empty(q ? 'Hech narsa topilmadi' : 'Ro\'yxat bo\'sh', q ? 'Boshqa so\'z bilan urinib ko\'ring.' : 'Bu bo\'limda topshiriq yo\'q.'));
}

// ---------- Topshiriq shakli ----------
export function TaskForm(id) {
  const t = id ? S.tasks.find((x) => x.id === id) : null;
  if (id && !t) return h('main', { class: 'view' }, BackHead('Topilmadi'), Empty('Topshiriq topilmadi', ''));
  const v = t || { assignee_id: S.me.kind === 'rahbar' && other() ? other().id : S.me.id, due_date: '' };
  const f = {
    title: h('input', { class: 'input', id: 'f_title', value: v.title || '', maxlength: 300, required: true }),
    assignee: h('select', { class: 'input', id: 'f_assignee' }, S.profiles.map((p) => h('option', { value: p.id, selected: p.id === v.assignee_id }, p.short_name))),
    due: h('input', { class: 'input', id: 'f_due', type: 'date', value: v.due_date || '', required: true }),
    desc: h('textarea', { class: 'input', id: 'f_desc', value: v.description || '' }),
    purpose: h('input', { class: 'input', id: 'f_purpose', value: v.purpose || '' }),
    level: h('select', { class: 'input', id: 'f_level' }, h('option', { value: '' }, 'Tanlanmagan'),
      [[1, '1 · faqat ma\'lumot yig\'ish'], [2, '2 · variant va tavsiya'], [3, '3 · qaror, oldin xabar'], [4, '4 · qaror, keyin xabar'], [5, '5 · mustaqil qaror']]
        .map(([n, l]) => h('option', { value: n, selected: v.level === n }, l))),
    wait: h('input', { class: 'input', id: 'f_wait', list: 'contacts', value: (S.contacts.find((c) => c.id === v.waiting_on) || {}).name || '', placeholder: 'Ism' }),
    priv: h('input', { type: 'checkbox', id: 'f_priv', checked: !!v.is_private }),
  };
  const err = h('div', { class: 'err' });
  const btn = h('button', { class: 'btn', type: 'submit' }, t ? 'Saqlash' : 'Topshiriq yaratish');
  const fld = (label, el, req) => h('div', { class: 'field' }, h('label', { for: el.id }, label, req && h('span', { class: 'req' }, ' *')), el);

  return h('main', { class: 'view' },
    BackHead(t ? 'Tahrirlash' : 'Yangi topshiriq', t ? `#/ish/${t.id}` : '#/ishlar'),
    h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      const title = f.title.value.trim();
      if (!title || !f.due.value) { err.textContent = 'Nima ish, kim bajaradi va qachongacha: shu uchtasi shart.'; return; }
      btn.disabled = true;
      let waiting_on = null; const wname = f.wait.value.trim();
      if (wname) {
        const found = S.contacts.find((c) => c.name.toLowerCase() === wname.toLowerCase());
        if (found) waiting_on = found.id;
        else { const { data, error } = await sb.from('contacts').insert({ name: wname, created_by: S.me.id }).select().single(); if (!error) { waiting_on = data.id; S.contacts.push(data); } }
      }
      const row = { title, assignee_id: f.assignee.value, due_date: f.due.value, description: f.desc.value.trim() || null, purpose: f.purpose.value.trim() || null,
        level: f.level.value ? Number(f.level.value) : null, waiting_on, is_private: f.priv.checked };
      let res;
      if (t) res = await sb.from('tasks').update(row).eq('id', t.id).select().single();
      else {
        row.creator_id = S.me.id; row.original_due_date = row.due_date;
        if (row.assignee_id === S.me.id) row.accepted_at = new Date().toISOString();
        res = await sb.from('tasks').insert(row).select().single();
      }
      btn.disabled = false;
      if (res.error) { err.textContent = 'Saqlab bo\'lmadi: ' + res.error.message; return; }
      if (!t) notify(row.assignee_id, 'yangi', 'Yangi topshiriq', title, res.data.id);
      await loadTasks(); toast(t ? 'Saqlandi' : 'Topshiriq yaratildi'); go(`#/ish/${res.data.id}`);
    } },
      fld('Nima ish', f.title, true),
      fld('Kim bajaradi', f.assignee, true),
      fld('Qachongacha', f.due, true),
      fld('Izoh', f.desc),
      fld('Nima uchun (maqsad)', f.purpose),
      fld('Vakolat darajasi', f.level),
      fld('Kimdan kutilmoqda', f.wait),
      h('datalist', { id: 'contacts' }, S.contacts.map((c) => h('option', { value: c.name }))),
      h('label', { class: 'check' }, f.priv, 'Faqat menga ko\'rinsin'),
      err, btn));
}

// ---------- Topshiriq sahifasi ----------
export function TaskDetail(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return h('main', { class: 'view' }, BackHead('Topilmadi'), Empty('Topshiriq topilmadi', 'U o\'chirilgan bo\'lishi mumkin.'));
  const me = S.me.id, mineToDo = t.assignee_id === me, iGave = t.creator_id === me;
  const pr = priority(t), du = dueChip(t);
  const contact = S.contacts.find((c) => c.id === t.waiting_on);
  const kv = (k, val) => h('div', {}, h('span', {}, k), h('b', {}, val));

  const actions = [];
  if (isOpen(t) && mineToDo && !t.accepted_at && !iGave) actions.push(h('button', { class: 'btn', onclick: () => acceptTask(t) }, 'Qabul qildim'));
  if (mineToDo && ['yangi', 'kutilmoqda'].includes(t.status)) actions.push(h('button', { class: 'btn ghost', onclick: () => updateTask(t.id, { status: 'jarayonda', accepted_at: t.accepted_at || new Date().toISOString() }, 'Jarayonda') }, 'Boshlash'));
  if (mineToDo && ['yangi', 'jarayonda'].includes(t.status)) actions.push(h('button', { class: 'btn ghost', onclick: () => setWaiting(t) }, 'Kutilmoqda'));
  if (mineToDo && t.status === 'kutilmoqda') actions.push(h('button', { class: 'btn ghost', onclick: () => setWaiting(t) }, 'Kimdan kutilayotganini o\'zgartirish'));
  if (mineToDo && ['yangi', 'jarayonda', 'kutilmoqda'].includes(t.status)) actions.push(h('button', { class: 'btn', onclick: () => submitTask(t) }, 'Bajarildi'));
  if (t.status === 'tekshiruvda' && iGave && !mineToDo) actions.push(h('button', { class: 'btn', onclick: () => acceptResult(t) }, 'Qabul qilish'), h('button', { class: 'btn ghost', onclick: () => returnTask(t) }, 'Qaytarish'));

  const manage = [];
  if (isOpen(t) && mineToDo && !iGave) manage.push(h('button', { class: 'btn ghost small', onclick: () => askReschedule(t) }, 'Muddatni ko\'chirish'));
  if (isOpen(t) && other()) manage.push(h('button', { class: 'btn ghost small', onclick: () => askDecision(t) }, 'Qaror so\'rash'));
  if (isOpen(t) && iGave) manage.push(h('a', { class: 'btn ghost small', href: `#/ish/${t.id}/tahrir` }, 'Tahrirlash'));
  if (isOpen(t) && iGave) manage.push(h('button', { class: 'btn ghost small', onclick: async () => { if (await confirmBox({ title: 'Bekor qilinsinmi?', text: 'Topshiriq tarixda «Bekor qilindi» bo\'lib qoladi.', ok: 'Bekor qilish' })) updateTask(t.id, { status: 'bekor', closed_at: new Date().toISOString() }, 'Bekor qilindi'); } }, 'Bekor qilish'));
  if (iGave || S.me.is_admin) manage.push(h('button', { class: 'btn danger small', onclick: async () => { if (await confirmBox({ title: 'Savatga tashlansinmi?', text: '30 kun ichida qaytarib olsa bo\'ladi.', ok: 'Savatga', danger: true })) { if (await updateTask(t.id, { deleted_at: new Date().toISOString(), deleted_by: me }, 'Savatga tashlandi')) go('#/ishlar'); } } }, 'O\'chirish'));

  const comments = h('div', { class: 'log' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const events = h('div', { class: 'log' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const cInput = h('textarea', { class: 'input', id: 'c_new', placeholder: 'Izoh yozing', style: 'min-height:60px' });

  const loadLogs = async () => {
    const [c, e] = await Promise.all([
      sb.from('task_comments').select('*').eq('task_id', id).order('created_at'),
      sb.from('task_events').select('*').eq('task_id', id).order('created_at', { ascending: false }),
    ]);
    comments.replaceChildren(...((c.data || []).length ? c.data.map((r) => h('div', { class: 'item' },
      h('span', { class: 'who' }, nameOf(r.author_id, true)), ' ', h('span', { class: 'when' }, fmtDateTime(r.created_at)), h('div', { class: 'text' }, r.body)))
      : [h('div', { class: 't-meta' }, 'Hali izoh yo\'q.')]));
    events.replaceChildren(...((e.data || []).length ? e.data.map((r) => h('div', { class: 'item' },
      h('span', { class: 'who' }, r.actor_id ? nameOf(r.actor_id, true) : 'Tizim'), ' ', h('span', { class: 'when' }, fmtDateTime(r.created_at)),
      h('div', {}, eventText(r)))) : [h('div', { class: 't-meta' }, 'O\'zgarish yo\'q.')]));
  };
  loadLogs();

  return h('main', { class: 'view' },
    BackHead(`Topshiriq №${t.seq}`),
    h('section', { class: 'card' },
      h('div', { class: 'between' },
        pr ? h('span', { class: `chip ${pr.cls}` }, pr.label) : h('span', { class: `chip ${t.status === 'bajarildi' ? 'green' : 'grey'}` }, STATUS[t.status]),
        du ? h('span', { class: `chip ${du.cls}` }, du.label) : t.status === 'bajarildi' && onTime(t) !== null ? h('span', { class: `chip ${onTime(t) ? 'green' : 'amber'}` }, onTime(t) ? 'Vaqtida' : 'Kechikib') : null),
      h('h2', { class: 't-title', style: 'font-size:18px' }, t.title),
      t.description && h('div', { class: 'text' }, t.description),
      h('div', { class: 'kv' },
        kv('Holati', STATUS[t.status]), kv('Muddat', fmtDate(t.due_date)),
        kv('Topshiruvchi', nameOf(t.creator_id)), kv('Mas\'ul', nameOf(t.assignee_id)),
        kv('Yaratilgan', fmtDate(dayOf(t.created_at))), kv('Qabul qilingan', t.accepted_at ? fmtDate(dayOf(t.accepted_at)) : 'Hali yo\'q'),
        t.submitted_at && kv('Bajarilgan', fmtDate(dayOf(t.submitted_at))),
        t.level && kv('Vakolat darajasi', String(t.level)),
        contact && kv('Kimdan kutilmoqda', contact.name),
        t.reschedule_count > 0 && kv('Muddat ko\'chirilgan', `${t.reschedule_count} marta (asl: ${fmtDate(t.original_due_date)})`),
        t.returned_count > 0 && kv('Qaytarilgan', `${t.returned_count} marta`),
        t.is_private && kv('Ko\'rinishi', 'Faqat menga')),
      t.purpose && h('div', {}, h('div', { class: 't-meta' }, 'Nima uchun'), h('div', { class: 'text' }, t.purpose)),
      t.result && h('div', {}, h('div', { class: 't-meta' }, 'Natija'), h('div', { class: 'text' }, t.result))),
    actions.length ? h('div', { class: 'row', style: 'flex-wrap:wrap' }, actions) : null,
    KudosBlock(t),
    Files(t),
    h('div', { class: 'section' }, h('h2', {}, 'Izohlar')),
    h('section', { class: 'card' }, comments,
      h('div', { class: 'field' }, h('label', { for: 'c_new' }, 'Yangi izoh'), cInput),
      h('button', { class: 'btn ghost', onclick: async () => {
        const body = cInput.value.trim(); if (!body) return;
        const { error } = await sb.from('task_comments').insert({ task_id: id, author_id: me, body });
        if (error) { toast('Izoh saqlanmadi'); return; }
        cInput.value = ''; notify(mineToDo ? t.creator_id : t.assignee_id, 'izoh', 'Yangi izoh', body, id); loadLogs();
      } }, 'Izoh qo\'shish')),
    h('div', { class: 'section' }, h('h2', {}, 'O\'zgarishlar tarixi')),
    h('section', { class: 'card' }, events),
    manage.length ? h('div', { class: 'row', style: 'flex-wrap:wrap' }, manage) : null);
}

function eventText(r) {
  switch (r.field) {
    case 'yaratildi': return 'Topshiriq yaratildi';
    case 'holat': return `Holat: ${STATUS[r.old_value] || r.old_value} → ${STATUS[r.new_value] || r.new_value}`;
    case 'muddat': return `Muddat: ${fmtDate(r.old_value)} → ${fmtDate(r.new_value)}`;
    case 'masul': return `Mas'ul: ${nameOf(r.old_value, true)} → ${nameOf(r.new_value, true)}`;
    case 'nom': return 'Nomi o\'zgartirildi';
    case 'izoh': return 'Izoh o\'zgartirildi';
    case 'qabul_qilindi': return 'Qabul qilindi';
    case 'savatga': return 'Savatga tashlandi';
    case 'tiklandi': return 'Savatdan tiklandi';
    default: return r.field;
  }
}

// ---------- Tasdiq ----------
export function Approvals() {
  const reqs = pendingForMe();
  const rows = needsMe().sort(byDue);
  const sentTasks = S.tasks.filter((t) => t.status === 'tekshiruvda' && t.assignee_id === S.me.id && t.creator_id !== S.me.id);
  const sent = mySentRequests();
  const waitingSent = sent.filter((r) => r.status === 'kutilmoqda'), answered = sent.filter((r) => r.status !== 'kutilmoqda').slice(0, 15);
  return h('main', { class: 'view' },
    Head('Javob kutayotgan ishlar', 'Tasdiq', h('button', { class: 'btn pill small', onclick: () => askDecision(null) }, '+ Qaror so\'rash')),
    reqs.length + rows.length ? [reqs.map(RequestCard), rows.map(WaitCard)] : Empty('Javob kutayotgan ish yo\'q', 'Sizdan hech narsa so\'ralmagan.'),
    waitingSent.length + sentTasks.length ? [h('div', { class: 'section' }, h('h2', {}, 'Men yuborganlar, javob kutilmoqda')), waitingSent.map(SentCard), sentTasks.map(TaskCard)] : null,
    answered.length ? [h('div', { class: 'section' }, h('h2', {}, 'Javob berilganlar')), answered.map(SentCard)] : null);
}

// ---------- Hali tayyor bo'lmagan bo'limlar ----------
export function Soon(title, text) {
  return h('main', { class: 'view' }, Head('Tez orada', title), Empty('Bu bo\'lim hali qurilmoqda', text));
}

// ---------- Yana ----------
export function More() {
  const row = (title, sub, onclick) => h('button', { type: 'button', onclick }, h('span', {}, h('b', {}, title), h('small', {}, sub)), icon('next', 18, '#56645F'));
  const soon = () => toast('Bu bo\'lim keyingi bosqichda qo\'shiladi');
  return h('main', { class: 'view' },
    Head(`${S.me.short_name}${S.me.is_admin ? ' · admin' : ''}`, 'Yana'),
    h('div', { class: 'section' }, h('h2', { style: 'font-size:13px;color:var(--muted)' }, 'Ishlar')),
    h('div', { class: 'list' },
      row('Matndan qo\'shish', 'Bir nechta topshiriqni ro\'yxatdan kiritish', () => go('#/ishlar/matn')),
      row('Excelga chiqarish', 'Topshiriqlar, reja va hisobotlar bitta faylda', () => downloadExcel()),
      row('Tarix', 'Bajarilgan va bekor qilingan ishlar', () => { F.show = 'closed'; go('#/ishlar'); }),
      row('Kimdan kutilmoqda', 'Uchinchi shaxslardan kutilayotgan ishlar', () => go('#/kutilmoqda')),
      row('Savat', 'O\'chirilganlar, 30 kun ichida qaytariladi', () => go('#/savat')),
      row('Eslatmalar', 'Takrorlanadigan va bir martalik', () => go('#/eslatmalar')),
      row('Takrorlanuvchi topshiriqlar', 'Har hafta yoki har oy o\'zi ochiladi', () => go('#/takror'))),
    h('div', { class: 'section' }, h('h2', { style: 'font-size:13px;color:var(--muted)' }, 'Sozlamalar')),
    h('div', { class: 'list' },
      row('Mening sozlamalarim', 'Rang, tungi rejim, tinch soatlar', () => go('#/sozlamalar')),
      S.me.is_admin && row('Admin panel', 'Muhimlik, vaqtlar, maqsadlar, foydalanuvchilar', () => go('#/admin'))),
    h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox({ title: 'Hisobdan chiqilsinmi?', ok: 'Chiqish' })) { await unregisterDevice(); } else return; sb.auth.signOut(); } }, 'Hisobdan chiqish'));
}

// ---------- Savat ----------
export function Trash() {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const load = async () => {
    const { data } = await sb.from('tasks').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    box.replaceChildren(...((data || []).length ? data.map((t) => h('article', { class: 'card' },
      h('div', { class: 't-title' }, t.title),
      h('div', { class: 't-meta' }, `O'chirilgan: ${fmtDateTime(t.deleted_at)} · ${nameOf(t.deleted_by, true)}`),
      h('button', { class: 'btn ghost', onclick: async () => {
        const { error } = await sb.from('tasks').update({ deleted_at: null, deleted_by: null }).eq('id', t.id);
        if (error) { toast('Tiklab bo\'lmadi'); return; }
        await loadTasks(); toast('Tiklandi'); load();
      } }, 'Qaytarib olish'))) : [Empty('Savat bo\'sh', 'O\'chirilgan topshiriq yo\'q.')]));
  };
  load();
  return h('main', { class: 'view' }, BackHead('Savat', '#/yana'), box);
}
