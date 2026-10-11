import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://wjqxqswmpxsaodcnjsrf.supabase.co';
// Ochiq (publishable) kalit: brauzerda turishi uchun mo'ljallangan, ma'lumotni RLS himoya qiladi.
const SUPABASE_KEY = 'sb_publishable_wLaaHsyI1x2ZckLedH9T-g_eoq8qEwC';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const S = { session: null, me: null, profiles: [], settings: {}, contacts: [], tasks: [] };
export const bus = { render: () => {} };

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const P = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h11M15 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H6M9 21l-3-3 3-3"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
};
export function icon(name, size = 22, color = 'currentColor', width = 2) {
  return h('span', { 'aria-hidden': 'true', style: 'display:inline-flex', html:
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>` });
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/** Pastdan chiqadigan oyna: matn so'raydi. Bekor qilinsa null qaytaradi. */
export function ask({ title, label, placeholder = '', required = true, ok = 'Saqlash', value = '' }) {
  return new Promise((resolve) => {
    const ta = h('textarea', { class: 'input', id: 'askText', placeholder, value });
    const err = h('div', { class: 'err' });
    const close = (v) => { ov.remove(); resolve(v); };
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(null); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title),
        h('div', { class: 'field' }, h('label', { for: 'askText' }, label), ta),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, 'Bekor'),
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const v = ta.value.trim();
            if (required && !v) { err.textContent = 'Bu maydonni to\'ldiring'; return; }
            close(v);
          } }, ok))));
    document.body.append(ov); ta.focus();
  });
}

export function confirmBox({ title, text, ok = 'Ha', danger = false }) {
  return new Promise((resolve) => {
    const close = (v) => { ov.remove(); resolve(v); };
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(false); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title), text && h('p', { class: 't-meta', style: 'font-size:14px' }, text),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close(false) }, 'Yo\'q'),
          h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', onclick: () => close(true) }, ok))));
    document.body.append(ov);
  });
}

// ---------- Sana ----------
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const dayOf = (ts) => (ts ? iso(new Date(ts)) : null);
export function fmtDate(s) { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts); const p = (n) => String(n).padStart(2, '0');
  return `${fmtDate(iso(d))} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function daysLeft(due) { return Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000); }
const OY = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const HAFTA = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
export function longToday() { const d = new Date(); return { day: `${d.getDate()}-${OY[d.getMonth()]}`, week: HAFTA[d.getDay()] }; }
export function greeting() { const hr = new Date().getHours(); return hr < 11 ? 'Xayrli tong' : hr < 17 ? 'Xayrli kun' : 'Xayrli kech'; }

// ---------- Topshiriq mantig'i ----------
export const STATUS = { yangi: 'Yangi', jarayonda: 'Jarayonda', kutilmoqda: 'Kutilmoqda', tekshiruvda: 'Tekshiruvda', bajarildi: 'Bajarildi', bekor: 'Bekor qilindi' };
export const isOpen = (t) => !['bajarildi', 'bekor'].includes(t.status);

export function priority(t) {
  if (!isOpen(t)) return null;
  const m = S.settings.muhimlik || { muhim_kun: 3, ortacha_kun: 10 };
  const d = daysLeft(t.due_date);
  if (d <= m.muhim_kun) return { key: 'muhim', label: 'Muhim!', cls: 'red' };
  if (d <= m.ortacha_kun) return { key: 'ortacha', label: 'O\'rtacha', cls: 'amber' };
  return { key: 'emas', label: 'Muhim emas', cls: 'grey' };
}
export function dueChip(t) {
  if (!isOpen(t)) return null;
  const d = daysLeft(t.due_date);
  if (d < 0) return { label: `Kechikdi · ${-d} kun`, cls: 'red' };
  if (d === 0) return { label: 'Bugun', cls: 'amber' };
  if (d === 1) return { label: 'Ertaga', cls: 'amber' };
  return { label: `${d} kun qoldi`, cls: 'grey' };
}
/** Vaqtida bajarilganmi: bajarildi bosilgan kun muddatdan o'tmagan bo'lsa. */
export function onTime(t) { const d = dayOf(t.submitted_at || t.closed_at); return d ? d <= t.due_date : null; }
export function onTimeStats(tasks) {
  const done = tasks.filter((t) => t.status === 'bajarildi' && onTime(t) !== null);
  const good = done.filter(onTime).length;
  return { total: done.length, good, late: done.length - good, pct: done.length ? Math.round((good / done.length) * 100) : null };
}

export const profile = (id) => S.profiles.find((p) => p.id === id);
export const other = () => S.profiles.find((p) => p.id !== S.me.id);
/** tight=true: tor joylar uchun faqat ism. */
export function nameOf(id, tight = false) {
  const p = profile(id); if (!p) return '—';
  return tight ? p.short_name.split(' ')[0] : p.short_name;
}

// ---------- Ma'lumot ----------
export async function loadBase() {
  const [pr, st, ct] = await Promise.all([
    sb.from('profiles').select('*'),
    sb.from('app_settings').select('key,value'),
    sb.from('contacts').select('*').order('name'),
  ]);
  if (pr.error) throw pr.error;
  S.profiles = pr.data || [];
  S.settings = Object.fromEntries((st.data || []).map((r) => [r.key, r.value]));
  S.contacts = ct.data || [];
  S.me = S.profiles.find((p) => p.id === S.session.user.id) || null;
}
export async function loadTasks() {
  const { data, error } = await sb.from('tasks').select('*').is('deleted_at', null).order('due_date').order('seq');
  if (error) { toast('Topshiriqlarni yuklab bo\'lmadi'); return; }
  S.tasks = data || [];
}
export async function updateTask(id, patch, okMsg) {
  const { error } = await sb.from('tasks').update(patch).eq('id', id);
  if (error) { toast('Saqlab bo\'lmadi: ' + error.message); return false; }
  await loadTasks(); if (okMsg) toast(okMsg); bus.render(); return true;
}
export async function notify(userId, kind, title, body, refId) {
  if (!userId || userId === S.me.id) return;
  await sb.from('notifications').insert({ user_id: userId, kind, title, body, ref_type: 'task', ref_id: refId });
}

// ---------- Umumiy ekran bo'laklari ----------
export const go = (hash) => { location.hash = hash; };
export function Head(sub, title, right) {
  return h('header', { class: 'head' }, h('div', {}, h('div', { class: 'sub' }, sub), h('h1', {}, title)), right);
}
export function BackHead(title, to = '#/ishlar') {
  return h('header', { class: 'head', style: 'padding-top:14px' },
    h('div', {}, h('button', { class: 'back', type: 'button', onclick: () => go(to) }, icon('back', 20), 'Orqaga'), h('h1', { style: 'font-size:22px' }, title)));
}
export function Empty(title, text) { return h('div', { class: 'empty' }, h('b', {}, title), text); }

// ---------- Sana (qo'shimcha) ----------
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = (s) => addDays(s, -((new Date(s + 'T12:00:00').getDay() + 6) % 7));
export const monthStart = (s) => s.slice(0, 8) + '01';
export const monthEnd = (s) => { const d = new Date(s.slice(0, 8) + '01T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); };
export function fmtDay(s) { const d = new Date(s + 'T12:00:00'); return `${d.getDate()}-${OY[d.getMonth()]}, ${HAFTA[d.getDay()].toLowerCase()}`; }
export const monthName = (s) => { const d = new Date(s + 'T12:00:00'); return `${OY[d.getMonth()]} ${d.getFullYear()}`; };
export const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ---------- Reja, hisobot, so'rovlar ----------
S.plan = []; S.requests = []; S.reports = [];
/** Reja va hisobot egasi: yordamchi. Tasdiqlovchi: ikkinchi kishi. */
export const owner = () => S.profiles.find((p) => p.kind === 'yordamchi') || S.me;
export const approverOf = (id) => S.profiles.find((p) => p.id !== id) || null;

export async function loadPlan() {
  const { data, error } = await sb.from('plan_items').select('*').gte('plan_date', addDays(today(), -62)).order('plan_date');
  if (!error) S.plan = data || [];
}
export async function loadRequests() {
  const { data, error } = await sb.from('requests').select('*').order('created_at', { ascending: false }).limit(300);
  if (!error) S.requests = data || [];
}
export async function loadReports() {
  const { data, error } = await sb.from('reports').select('*').order('period_start', { ascending: false }).limit(300);
  if (!error) S.reports = data || [];
}
export async function loadAll() { await Promise.all([loadTasks(), loadPlan(), loadRequests(), loadReports()]); }
export async function ping(userId, kind, title, body, refType, refId) {
  if (!userId || userId === S.me.id) return;
  await sb.from('notifications').insert({ user_id: userId, kind, title, body, ref_type: refType, ref_id: refId });
}
