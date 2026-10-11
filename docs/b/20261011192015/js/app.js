import { sb, S, bus, h, icon, loadBase, loadTasks, loadAll, toast, countUp } from './core.js';
import { ReportsView, ReportDetail, pendingForMe } from './plan.js';
import { loadExtra, runRecurrences, Calendar, Reminders, Recurrences, Admin, WaitingOn } from './extra.js';
import { Login, NoProfile, Home, Tasks, TaskForm, TaskDetail, Approvals, Soon, More, Trash, needsMe } from './views.js';

const app = document.getElementById('app');

const NAV = [
  ['#/bugun', 'Bugun', 'home'], ['#/ishlar', 'Ishlar', 'list'], ['#/taqvim', 'Taqvim', 'cal'],
  ['#/tasdiq', 'Tasdiq', 'check'], ['#/hisobot', 'Hisobot', 'chart'], ['#/yana', 'Yana', 'more'],
];

function Nav(active) {
  const n = needsMe().length + pendingForMe().length;
  return h('nav', { class: 'nav', 'aria-label': 'Asosiy menyu' }, h('div', { class: 'in' },
    NAV.map(([href, label, ic]) => h('a', { href, class: href === active ? 'on' : '', 'aria-current': href === active ? 'page' : null },
      icon(ic), label, href === '#/tasdiq' && n > 0 ? h('span', { class: 'badge' }, n) : null))));
}

function route() {
  const hash = location.hash || '#/bugun';
  let m;
  if (hash === '#/bugun') return [Home(), '#/bugun'];
  if (hash === '#/ishlar') return [Tasks(), '#/ishlar'];
  if (hash === '#/ishlar/yangi') return [TaskForm(null), '#/ishlar'];
  if ((m = hash.match(/^#\/ish\/([0-9a-f-]+)\/tahrir$/))) return [TaskForm(m[1]), '#/ishlar'];
  if ((m = hash.match(/^#\/ish\/([0-9a-f-]+)$/))) return [TaskDetail(m[1]), '#/ishlar'];
  if (hash === '#/taqvim') return [Calendar(), hash];
  if (hash === '#/eslatmalar') return [Reminders(), '#/yana'];
  if (hash === '#/takror') return [Recurrences(), '#/yana'];
  if (hash === '#/kutilmoqda') return [WaitingOn(), '#/yana'];
  if (hash === '#/admin') return [Admin(), '#/yana'];
  if (hash === '#/tasdiq') return [Approvals(), hash];
  if (hash === '#/hisobot') return [ReportsView(), hash];
  if ((m = hash.match(/^#\/hisobot\/([0-9a-f-]+)$/))) return [ReportDetail(m[1]), '#/hisobot'];
  if (hash === '#/yana') return [More(), hash];
  if (hash === '#/savat') return [Trash(), '#/yana'];
  location.hash = '#/bugun';
  return [Home(), '#/bugun'];
}

let ready = false, booted = false, swipeDir = 0;

// Barmoq bilan o'ngga-chapga surib, pastki menyudagi qo'shni bo'limga o'tish
let touch = null;
const scrollsSideways = (el) => { for (; el && el !== app; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; return false; };
app.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touch = e.touches.length === 1 && !scrollsSideways(e.target) && !e.target.closest('input[type=range], textarea') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
}, { passive: true });
app.addEventListener('touchend', (e) => {
  if (!touch || document.querySelector('.overlay')) { touch = null; return; }
  const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y, quick = Date.now() - touch.at < 700;
  touch = null;
  if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
  const i = NAV.findIndex(([href]) => href === (location.hash || '#/bugun'));
  const next = i < 0 ? null : NAV[i + (dx < 0 ? 1 : -1)];
  if (!next) return;
  swipeDir = dx < 0 ? 1 : -1; location.hash = next[0];
}, { passive: true });
function render() {
  // Kirish animatsiyasi tugashini kutamiz (faqat birinchi ochilishda, 1,4 soniyagacha)
  if (!booted) {
    const still = !matchMedia('(prefers-reduced-motion: reduce)').matches && document.querySelector('.boot svg');
    const left = 1400 - (performance.now() - (window.__bootAt || 0));
    if (still && left > 0) { clearTimeout(render.t); render.t = setTimeout(render, left); return; }
    if (S.session ? ready : true) { booted = true; }
  }
  if (!S.session) { app.replaceChildren(Login()); return; }
  if (!ready) return;
  if (!S.me) { app.replaceChildren(NoProfile()); return; }
  const y = window.scrollY, prev = render.last;
  const [view, active] = route();
  if (prev !== location.hash) { view.classList.add(swipeDir ? (swipeDir > 0 ? 'slideL' : 'slideR') : 'pagein'); swipeDir = 0; }
  app.replaceChildren(view, Nav(active));
  if (prev !== location.hash && (location.hash || '#/bugun') === '#/bugun') countUp(view);
  render.last = location.hash;
  window.scrollTo(0, prev === location.hash ? y : 0);
}
bus.render = render;
window.addEventListener('hashchange', render);

/** Foydalanuvchi yozayotgan yoki oyna ochiq bo'lsa, ekranni o'zidan-o'zi yangilamaymiz. */
function busy() {
  if (document.querySelector('.overlay')) return true;
  const el = document.activeElement;
  return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'checkbox';
}
let channel = null;
async function start(session) {
  // Hisobdan chiqilganda sahifani to'liq yangilaymiz: oldingi foydalanuvchining filtrlari va ma'lumoti xotirada qolmasin.
  if (!session && S.session) { history.replaceState(null, '', '#/bugun'); location.reload(); return; }
  S.session = session; ready = false;
  if (!session) { if (channel) { sb.removeChannel(channel); channel = null; } S.me = null; S.tasks = []; history.replaceState(null, '', '#/bugun'); render(); return; }
  try { await loadBase(); if (S.me) { await Promise.all([loadAll(), loadExtra()]); await runRecurrences(); } }
  catch (e) { toast('Ma\'lumotni yuklab bo\'lmadi. Internetni tekshiring.'); }
  ready = true; render();
  if (S.me && !channel) {
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { await Promise.all([loadAll(), loadExtra()]); if (!busy()) render(); }, 400); };
    channel = sb.channel('devon-data');
    for (const table of ['tasks', 'plan_items', 'requests', 'reports', 'events', 'reminders']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    channel.subscribe();
  }
}

let currentUser = null;
sb.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id || null;
  if (uid === currentUser && S.session) { S.session = session; return; }
  currentUser = uid;
  // Supabase tavsiyasi: auth qayta chaqiruvi ichida boshqa so'rovlarni kutmaslik
  setTimeout(() => start(session), 0);
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.me) { await Promise.all([loadAll(), loadExtra()]); await runRecurrences(); if (!busy()) render(); }
});
