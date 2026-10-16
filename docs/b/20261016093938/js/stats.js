// ---------- Statistika: alohida bo'lim ----------
import { S, bus, h, icon, today, dayOf, isOpen, onTime, nameOf, STATUS, Head, Empty, addDays, mondayOf, monthStart, monthEnd } from './core.js';
import { TaskCard } from './views.js';

// Tanlovlar sahifa yopilib ochilganda ham saqlanib turadi (shu seans davomida)
const ST = { range: 'oy', who: 'hammasi' };

const OY_QISQA = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const HAFTA_QISQA = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

const doneDay = (t) => dayOf(t.submitted_at || t.closed_at);
const inRange = (d, a, b) => !!d && d >= a && d <= b;
const pc = (v) => (v == null ? '—' : v + '%');

function rangeOf(key) {
  const t = today();
  if (key === 'hafta') return [mondayOf(t), addDays(mondayOf(t), 6)];
  if (key === 'oy') return [monthStart(t), monthEnd(t)];
  if (key === '3oy') { const d = new Date(t + 'T12:00:00'); d.setMonth(d.getMonth() - 2); return [monthStart(dayOf(d) || t), monthEnd(t)]; }
  if (key === 'yil') return [t.slice(0, 4) + '-01-01', t.slice(0, 4) + '-12-31'];
  return ['2000-01-01', '2999-12-31'];
}

/** Tanlangan kishi(lar)ga biriktirilgan topshiriqlar. */
function tasksOf(who) {
  return S.tasks.filter((t) => t.status !== 'bekor' && (who === 'hammasi' || t.assignee_id === who));
}

/** Bir guruh topshiriq bo'yicha asosiy raqamlar. */
function numbers(tasks, a, b) {
  const done = tasks.filter((t) => t.status === 'bajarildi' && inRange(doneDay(t), a, b));
  const timed = done.filter((t) => onTime(t) !== null);
  const good = timed.filter(onTime).length;
  const open = tasks.filter(isOpen);
  const overdue = open.filter((t) => t.due_date < today());
  const spans = done.map((t) => (Date.parse(doneDay(t) + 'T00:00:00Z') - Date.parse(dayOf(t.created_at) + 'T00:00:00Z')) / 86400000).filter((x) => x >= 0);
  return {
    done: done.length, good, late: timed.length - good,
    pct: timed.length ? Math.round((good / timed.length) * 100) : null,
    open: open.length, overdue: overdue.length,
    created: tasks.filter((t) => inRange(dayOf(t.created_at), a, b)).length,
    avg: spans.length ? Math.round((spans.reduce((s, x) => s + x, 0) / spans.length) * 10) / 10 : null,
    moved: tasks.filter((t) => (t.reschedule_count || 0) > 0 && inRange(dayOf(t.created_at), a, b)).length,
    returned: tasks.filter((t) => (t.returned_count || 0) > 0 && (inRange(doneDay(t), a, b) || isOpen(t))).length,
  };
}

const chip = (cur, val, label, set) => h('button', { type: 'button', class: 'fchip' + (cur === val ? ' on' : ''), 'aria-pressed': String(cur === val), onclick: () => { set(val); bus.render(); } }, label);
const tile = (val, label, cls = '') => h('div', { class: 'tile', style: 'cursor:default' }, h('b', { class: cls }, val), h('span', {}, label));
const row = (label, val, note) => h('div', { class: 'between', style: 'padding:8px 0;border-top:1px solid var(--soft)' },
  h('span', {}, label, note && h('span', { class: 't-meta' }, ' · ' + note)), h('b', {}, val));

/** Ikkalasini yonma-yon solishtirish. */
function Compare(a, b) {
  const people = S.profiles.slice().sort((x, y) => (x.id === S.me.id ? -1 : y.id === S.me.id ? 1 : 0));
  if (people.length < 2) return null;
  const data = people.map((p) => ({ p, n: numbers(tasksOf(p.id), a, b) }));
  const max = Math.max(1, ...data.map((d) => d.n.done));
  return [h('div', { class: 'section' }, h('h2', {}, 'Ikkalamiz')),
    h('section', { class: 'card', style: 'gap:14px' }, data.map(({ p, n }) => h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
      h('div', { class: 'between' }, h('b', {}, nameOf(p.id)), h('span', { class: 'chip ' + (n.pct == null ? 'grey' : n.pct >= 90 ? 'green' : n.pct >= 70 ? 'amber' : 'red') }, 'Vaqtida ' + pc(n.pct))),
      h('div', { class: 'bar two', role: 'img', 'aria-label': `${n.good} tasi vaqtida, ${n.late} tasi kechikib bajarilgan` },
        n.done ? [h('div', { style: `flex:${n.good}` }), h('div', { class: 'late', style: `flex:${n.late}` }), h('div', { style: `flex:${max - n.done};background:transparent` })] : null),
      h('div', { class: 'stat4' },
        h('span', {}, h('b', {}, n.done), 'bajarildi'),
        h('span', {}, h('b', {}, n.open), 'ochiq'),
        h('span', {}, h('b', { class: n.overdue ? 'c-red' : '' }, n.overdue), 'kechikkan'),
        h('span', {}, h('b', {}, n.avg == null ? '—' : n.avg), 'kunda o\'rtacha'))))),
  ];
}

/** Oxirgi 6 oy: bajarilgan topshiriqlar (vaqtida / kechikib). */
function MonthsChart(tasks) {
  const months = [];
  const base = new Date(today().slice(0, 8) + '01T12:00:00');
  for (let i = 5; i >= 0; i--) { const d = new Date(base); d.setMonth(d.getMonth() - i); months.push(dayOf(d)); }
  const cols = months.map((m) => {
    const a = monthStart(m), b = monthEnd(m);
    const done = tasks.filter((t) => t.status === 'bajarildi' && inRange(doneDay(t), a, b));
    const good = done.filter((t) => onTime(t) !== false).length;
    return { label: OY_QISQA[Number(m.slice(5, 7)) - 1], good, late: done.length - good, total: done.length };
  });
  const max = Math.max(1, ...cols.map((c) => c.total));
  if (!cols.some((c) => c.total)) return [h('div', { class: 'section' }, h('h2', {}, 'Oylar bo\'yicha')), Empty('Hali ma\'lumot yo\'q', 'Bajarilgan topshiriqlar paydo bo\'lgach, grafik chiqadi.')];
  return [h('div', { class: 'section' }, h('h2', {}, 'Oylar bo\'yicha'), h('span', { class: 't-meta' }, 'oxirgi 6 oy')),
    h('section', { class: 'card' },
      h('div', { class: 'vchart', role: 'img', 'aria-label': cols.map((c) => `${c.label}: ${c.total} ta, ${c.late} tasi kechikib`).join('; ') },
        cols.map((c) => h('div', { class: 'vcol' },
          h('small', {}, c.total || ''),
          h('div', { class: 'vbar', style: `height:${Math.max(4, Math.round((c.total / max) * 110))}px` },
            c.late ? h('i', { class: 'late', style: `flex:${c.late}` }) : null, c.good ? h('i', { style: `flex:${c.good}` }) : null),
          h('span', {}, c.label)))),
      h('div', { class: 'legend' }, h('span', {}, h('i', {}), 'Vaqtida'), h('span', {}, h('i', { class: 'late' }), 'Kechikib')))];
}

/** Oxirgi 14 kun: kunlik reja necha foiz bajarilgan. */
function PlanChart(who) {
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
  const mine = (i) => who === 'hammasi' || (i.for_id || i.owner_id) === who;
  const cols = days.map((d) => {
    const items = S.plan.filter((i) => i.plan_date === d && mine(i));
    const done = items.filter((i) => i.done).length;
    return { d, total: items.length, done, pct: items.length ? Math.round((done / items.length) * 100) : null };
  });
  const withPlan = cols.filter((c) => c.total);
  if (!withPlan.length) return [h('div', { class: 'section' }, h('h2', {}, 'Kunlik reja')), Empty('Reja yo\'q', 'Oxirgi 14 kunda reja bandlari topilmadi.')];
  const sumDone = withPlan.reduce((s, c) => s + c.done, 0), sumAll = withPlan.reduce((s, c) => s + c.total, 0);
  return [h('div', { class: 'section' }, h('h2', {}, 'Kunlik reja'), h('span', { class: 't-meta' }, `14 kunda ${Math.round((sumDone / sumAll) * 100)}%`)),
    h('section', { class: 'card' },
      h('div', { class: 'vchart small', role: 'img', 'aria-label': withPlan.map((c) => `${c.d}: ${c.done}/${c.total}`).join('; ') },
        cols.map((c) => h('div', { class: 'vcol' + (c.d === today() ? ' now' : '') },
          h('small', {}, c.pct == null ? '' : c.pct),
          h('div', { class: 'vbar' + (c.pct === 100 ? ' full' : ''), style: `height:${c.pct == null ? 0 : Math.max(4, Math.round(c.pct * 0.9))}px` }, c.total ? h('i', {}) : null),
          h('span', {}, HAFTA_QISQA[new Date(c.d + 'T12:00:00').getDay()])))),
      h('div', { class: 't-meta' }, `Bajarilgan bandlar: ${sumDone} / ${sumAll}. To'liq bajarilgan kunlar: ${withPlan.filter((c) => c.pct === 100).length}.`))];
}

/** Hozirgi holatlar taqsimoti (ochiq ishlar + davrda bajarilganlar). */
function StatusSplit(tasks, a, b) {
  const order = ['yangi', 'jarayonda', 'kutilmoqda', 'tekshiruvda'];
  const counts = order.map((s) => [s, tasks.filter((t) => t.status === s).length]);
  counts.push(['bajarildi', tasks.filter((t) => t.status === 'bajarildi' && inRange(doneDay(t), a, b)).length]);
  const max = Math.max(1, ...counts.map(([, n]) => n));
  const cls = { yangi: 'blue', jarayonda: 'brand', kutilmoqda: 'amber', tekshiruvda: 'gold', bajarildi: 'done' };
  return [h('div', { class: 'section' }, h('h2', {}, 'Holatlar bo\'yicha')),
    h('section', { class: 'card', style: 'gap:8px' }, counts.map(([s, n]) => h('div', { class: 'hrow' },
      h('span', {}, STATUS[s], s === 'bajarildi' && h('small', { class: 't-meta' }, ' (davrda)')),
      h('div', { class: 'hbar' }, h('i', { class: cls[s], style: `width:${n ? Math.max(3, Math.round((n / max) * 100)) : 0}%` })),
      h('b', {}, n))))];
}

export function Stats() {
  const [a, b] = rangeOf(ST.range);
  const who = ST.who === 'men' ? S.me.id : ST.who === 'u' ? S.profiles.find((p) => p.id !== S.me.id)?.id || 'hammasi' : 'hammasi';
  const tasks = tasksOf(who);
  const n = numbers(tasks, a, b);
  const ot = S.profiles.find((p) => p.id !== S.me.id);
  const overdue = tasks.filter((t) => isOpen(t) && t.due_date < today()).sort((x, y) => (x.due_date < y.due_date ? -1 : 1));
  const fromBoss = S.tasks.filter((t) => t.creator_id !== t.assignee_id && inRange(dayOf(t.created_at), a, b));

  return h('main', { class: 'view' },
    Head('Ko\'rsatkichlar va natijalar', 'Statistika'),
    h('div', { class: 'filters' },
      chip(ST.range, 'hafta', 'Hafta', (v) => { ST.range = v; }), chip(ST.range, 'oy', 'Oy', (v) => { ST.range = v; }),
      chip(ST.range, '3oy', '3 oy', (v) => { ST.range = v; }), chip(ST.range, 'yil', 'Yil', (v) => { ST.range = v; }),
      chip(ST.range, 'hammasi', 'Hammasi', (v) => { ST.range = v; })),
    ot && h('div', { class: 'filters' },
      chip(ST.who, 'hammasi', 'Ikkalamiz', (v) => { ST.who = v; }), chip(ST.who, 'men', 'Men', (v) => { ST.who = v; }),
      chip(ST.who, 'u', nameOf(ot.id, true), (v) => { ST.who = v; })),
    h('div', { class: 'tiles' },
      tile(n.done, 'Bajarildi', 'c-brand'), tile(pc(n.pct), 'Vaqtida', 'c-brand'),
      tile(n.open, 'Ochiq'), tile(n.overdue, 'Kechikkan', n.overdue ? 'c-red' : '')),
    n.done ? h('section', { class: 'card' },
      h('div', { class: 'between' }, h('b', {}, 'Vaqtida bajarish'), h('b', { class: 'c-brand', style: 'font-size:22px' }, pc(n.pct))),
      h('div', { class: 'bar two', role: 'img', 'aria-label': `${n.good} tasi vaqtida, ${n.late} tasi kechikib` }, [h('div', { style: `flex:${n.good}` }), h('div', { class: 'late', style: `flex:${n.late}` })]),
      h('div', { class: 'between t-meta' }, h('span', {}, `Vaqtida: ${n.good}`), h('span', {}, `Kechikib: ${n.late}`)),
      h('div', { class: 't-meta' }, `Maqsad: ${(S.settings.maqsad || { vaqtida_foiz: 90 }).vaqtida_foiz}% va undan yuqori`)) : null,
    ST.who === 'hammasi' ? Compare(a, b) : null,
    MonthsChart(tasks),
    PlanChart(who),
    StatusSplit(tasks, a, b),
    h('div', { class: 'section' }, h('h2', {}, 'Qo\'shimcha')),
    h('section', { class: 'card', style: 'gap:0' },
      row('Davrda berilgan topshiriqlar', n.created),
      row('Biri ikkinchisiga bergan', fromBoss.length, ot ? `${nameOf(ot.id, true)}dan ${fromBoss.filter((t) => t.creator_id === ot.id).length} ta` : null),
      row('O\'rtacha bajarish muddati', n.avg == null ? '—' : `${n.avg} kun`),
      row('Muddati ko\'chirilgan', n.moved),
      row('Qaytarilgan', n.returned)),
    h('div', { class: 'section' }, h('h2', {}, 'Kechikkan ochiq ishlar'), overdue.length ? h('span', { class: 'chip red' }, overdue.length) : null),
    overdue.length ? overdue.slice(0, 10).map(TaskCard) : Empty('Kechikkan ish yo\'q', 'Barcha ochiq ishlar muddatida.'),
    overdue.length > 10 && h('a', { href: '#/ishlar', class: 't-meta', style: 'font-weight:700;color:var(--brand);min-height:44px;display:flex;align-items:center;gap:2px;padding:0 4px' }, `Yana ${overdue.length - 10} ta — ro'yxatda ko'rish`, icon('next', 16)),
    h('div', { class: 't-meta', style: 'padding:0 4px' }, 'Hisobot intizomi va yutuqlar «Hisobot → Statistika» varag\'ida.'));
}
