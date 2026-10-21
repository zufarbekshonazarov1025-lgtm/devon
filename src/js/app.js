import { sb, S, bus, h, icon, loadBase, loadTasks, loadAll, toast, countUp, wide, WIDE_MQ } from './core.js';
import { ReportsView, ReportDetail, pendingForMe } from './plan.js';
import { loadExtra, runRecurrences, calShift, calGoto, pendingReminders, pendingDueTasks, Calendar, Reminders, Recurrences, Admin, WaitingOn } from './extra.js';
import { loadMore, applyTheme, Notifications, MySettings, FromText, navItems, navChoices } from './more.js';
import { Money, MoneySettings, Debts, DebtDetail } from './money.js';
import { driveReturn } from './files.js';
import { Stats } from './stats.js';
import { registerDevice } from './native.js';
import { Login, NoProfile, Home, Tasks, TaskForm, TaskDetail, Approvals, Soon, More, Trash, needsMe } from './views.js';

const app = document.getElementById('app');

// Uzun sahifada pastga tushganda «Tepaga» tugmasi chiqadi
// (sahifani ba'zan window, ba'zan body suradi — ikkalasini ham hisobga olamiz)
const scrolled = () => Math.max(window.scrollY, document.body.scrollTop, document.documentElement.scrollTop);
const upBtn = h('button', { class: 'totop', type: 'button', onclick: () => { for (const el of [window, document.body, document.documentElement]) el.scrollTo({ top: 0, behavior: 'smooth' }); } }, '↑ Tepaga');
document.body.append(upBtn);
function showUp() { upBtn.classList.toggle('on', !!S.session && scrolled() > 500); }
document.addEventListener('scroll', showUp, { passive: true, capture: true });

// Sahifa surilsa, ochiq klaviatura va maydon ostidagi tavsiyalar yopiladi
let dragY = null;
window.addEventListener('touchstart', (e) => { dragY = e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
window.addEventListener('touchmove', (e) => {
  const a = document.activeElement;
  if (dragY === null || !a || !a.matches('input, textarea, select')) return;
  if (a.tagName === 'TEXTAREA' && a.contains(e.target)) return; // uzun matn ichida surish — yozishni to'xtatmaymiz
  if (Math.abs(e.touches[0].clientY - dragY) > 24) { a.blur(); dragY = null; }
}, { passive: true });

// Pastdan chiqqan oynani barmoq bilan pastga tortib yopish (fonni bosgandek — hech narsa saqlanmaydi)
let pull = null;
document.addEventListener('touchstart', (e) => {
  const sh = e.target.closest && e.target.closest('.sheet');
  pull = null;
  if (!sh || e.touches.length !== 1 || sh.scrollTop > 0 || e.target.closest('textarea, select, input[type=range]')) return;
  pull = { sh, y: e.touches[0].clientY, dy: 0, at: Date.now() };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!pull) return;
  const dy = Math.max(0, e.touches[0].clientY - pull.y), sh = pull.sh;
  pull.dy = dy;
  sh.style.animation = 'none'; sh.style.transition = 'none';
  sh.style.transform = dy ? `translateY(${dy}px)` : '';
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!pull) return;
  const { sh, dy, at } = pull; pull = null;
  if (!dy) return;
  if (dy > Math.min(140, sh.offsetHeight * 0.25) || (dy > 50 && Date.now() - at < 300)) {
    sh.style.transition = 'transform .18s ease-in'; sh.style.transform = 'translateY(110%)';
    setTimeout(() => { const ov = sh.closest('.overlay'); if (ov) ov.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, 170);
  } else { sh.style.transition = 'transform .2s ease'; sh.style.transform = ''; }
}, { passive: true });

applyTheme();
driveReturn();


function Nav(active) {
  const n = needsMe().length + pendingForMe().length;
  const link = ([href, label, ic]) => h('a', { href, class: href === active ? 'on' : '', 'aria-current': href === active ? 'page' : null },
    icon(ic), href === '#/eslatmalar' && wide() ? 'Eslatmalar' : label, href === '#/tasdiq' && n > 0 ? h('span', { class: 'badge' }, n) : null);
  if (!wide()) return h('nav', { class: 'nav', 'aria-label': 'Asosiy menyu' }, h('div', { class: 'in' }, navItems().map(link)));
  // Kompyuterda: chap tomonda hamma bo'limlar doim ko'rinib turadi
  const all = [['#/bugun', 'Bugun', 'home'], ...navChoices(), ['#/yana', 'Yana', 'more']];
  return h('nav', { class: 'nav side', 'aria-label': 'Asosiy menyu' }, h('div', { class: 'in' },
    h('a', { class: 'brandmark', href: '#/bugun', 'aria-label': 'Devon — bosh sahifa', html:
      '<svg width="34" height="34" viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="28" fill="#0B6B58"/><rect x="28" y="30" width="28" height="60" rx="5" fill="#fff"/><rect x="64" y="30" width="28" height="60" rx="5" fill="#fff"/><rect x="56" y="26" width="8" height="68" rx="4" fill="#E3B341"/></svg><b>Devon</b>' }),
    h('a', { class: 'btn newtask', href: '#/ishlar/yangi' }, icon('plus', 18, '#fff', 2.5), 'Yangi topshiriq'),
    all.map(link)));
}

function route() {
  const hash = location.hash || '#/bugun';
  let m;
  if (hash === '#/bugun') return [Home(), '#/bugun'];
  if (hash === '#/ishlar') return [Tasks(), '#/ishlar'];
  if (hash === '#/ishlar/matn') return [FromText(), '#/ishlar'];
  if (hash === '#/xabarlar') return [Notifications(), '#/bugun'];
  if (hash === '#/sozlamalar') return [MySettings(), '#/yana'];
  if (hash === '#/ishlar/yangi') return [TaskForm(null), '#/ishlar'];
  if ((m = hash.match(/^#\/ish\/([0-9a-f-]+)\/tahrir$/))) return [TaskForm(m[1]), '#/ishlar'];
  if ((m = hash.match(/^#\/ish\/([0-9a-f-]+)$/))) return [TaskDetail(m[1]), '#/ishlar'];
  if (hash === '#/taqvim') return [Calendar(), hash];
  if ((m = hash.match(/^#\/taqvim\/(\d{4}-\d{2}-\d{2})$/))) { calGoto(m[1]); history.replaceState(null, '', '#/taqvim'); return [Calendar(), '#/taqvim']; }
  if (hash === '#/eslatmalar') return [Reminders(), '#/yana'];
  if (hash === '#/takror') return [Recurrences(), '#/yana'];
  if (hash === '#/kutilmoqda') return [WaitingOn(), '#/yana'];
  if (hash === '#/admin') return [Admin(), '#/yana'];
  if (hash === '#/tasdiq') return [Approvals(), hash];
  if (hash === '#/hisobot') return [ReportsView(), hash];
  if ((m = hash.match(/^#\/hisobot\/([0-9a-f-]+)$/))) return [ReportDetail(m[1]), '#/hisobot'];
  if (hash === '#/statistika') return [Stats(), '#/yana'];
  if (hash === '#/pullar') return [Money(), hash];
  if (hash === '#/pullar/sozlama') return [MoneySettings(), '#/pullar'];
  if (hash === '#/pullar/qarzlar') return [Debts(), '#/pullar'];
  if ((m = hash.match(/^#\/pullar\/qarz\/([0-9a-f-]+)$/))) return [DebtDetail(m[1]), '#/pullar'];
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
  if (location.hash === '#/taqvim') { calShift(dx < 0 ? 1 : -1); document.querySelector('.view > .card, .view > .callist, .view > .empty')?.classList.add(dx < 0 ? 'slideL' : 'slideR'); return; }
  const NAV = navItems(), i = NAV.findIndex(([href]) => href === (location.hash || '#/bugun'));
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
  let [view, active] = route();
  if (navItems().some(([hh]) => hh === location.hash)) active = location.hash;
  if (prev !== location.hash) { view.classList.add(swipeDir ? (swipeDir > 0 ? 'slideL' : 'slideR') : 'pagein'); swipeDir = 0; }
  app.replaceChildren(view, Nav(active));
  if (prev !== location.hash && (location.hash || '#/bugun') === '#/bugun') countUp(view);
  render.last = location.hash;
  window.scrollTo(0, prev === location.hash ? y : 0);
  showUp();
}
bus.render = render;
// Eslatma vaqti kelganda ochiq ekran ham yangilansin (daqiqasiga bir tekshiramiz)
let remCount = -1;
setInterval(() => { if (!S.me || !ready) return; const n = pendingReminders().length * 1000 + pendingDueTasks().length; if (n !== remCount) { const first = remCount < 0; remCount = n; if (!first && !busy()) render(); } }, 60000);
window.addEventListener('hashchange', render);
// Oyna kengligi telefon/kompyuter chegarasidan o'tsa, ko'rinishni almashtiramiz
WIDE_MQ.addEventListener('change', () => { document.documentElement.classList.toggle('wide', wide()); if (!busy()) render(); });
document.documentElement.classList.toggle('wide', wide());

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
  try { await loadBase(); if (S.me) { await Promise.all([loadAll(), loadExtra(), loadMore()]); await runRecurrences(); } }
  catch (e) { toast('Ma\'lumotni yuklab bo\'lmadi. Internetni tekshiring.'); }
  ready = true; render();
  if (S.me) registerDevice();
  if (S.me && !channel) {
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { await Promise.all([loadAll(), loadExtra(), loadMore()]); if (!busy()) render(); }, 400); };
    channel = sb.channel('devon-data');
    for (const table of ['tasks', 'plan_items', 'requests', 'reports', 'events', 'reminders', 'reminder_acks', 'task_due_acks', 'notifications']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
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
  if (document.visibilityState === 'visible' && S.me) { await Promise.all([loadAll(), loadExtra(), loadMore()]); await runRecurrences(); if (!busy()) render(); }
});
