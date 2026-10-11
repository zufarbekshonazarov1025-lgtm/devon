import { sb, S, bus, h, icon, toast, confirmBox, fmtDateTime, nameOf, loadBase } from './core.js';

/** Server funksiyasini chaqiradi. Xato bo'lsa, o'zbekcha matnini qaytaradi. */
async function call(body) {
  const { data, error } = await sb.functions.invoke('drive', { body });
  if (!error) return { data };
  let msg = 'Server bilan bog\'lanib bo\'lmadi';
  try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* matn yo'q */ }
  return { err: msg };
}
export const driveOn = () => !!(S.settings.drive && S.settings.drive.connected);
const size = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url); x.responseType = 'json';
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 && x.response && x.response.id ? resolve(x.response.id) : reject(new Error('yuklanmadi')));
    x.onerror = () => reject(new Error('aloqa uzildi'));
    x.send(file);
  });
}

/** Topshiriq ichidagi «Hujjatlar» bo'limi. */
/** Davom etayotgan yuklashlar: topshiriq id → { text, k }. Ekran qayta chizilsa ham yo'qolmaydi. */
const UP = new Map();
function paint(taskId) {
  const box = document.getElementById('upl_' + taskId), btn = document.getElementById('uplbtn_' + taskId), u = UP.get(taskId);
  if (btn) { btn.disabled = !!u; btn.textContent = u ? 'Yuklanmoqda…' : '+ Fayl biriktirish'; }
  if (!box) return;
  box.style.display = u ? '' : 'none';
  if (u) { box.querySelector('.upltext').textContent = u.text; box.querySelector('.bar > div').style.width = `${Math.round(u.k * 100)}%`; }
}
const show = (taskId, text, k) => { if (text) UP.set(taskId, { text, k }); else UP.delete(taskId); paint(taskId); };

async function uploadAll(t, files) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i], tag = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
    show(t.id, `${tag}${f.name}: tayyorlanmoqda…`, 0.03);
    if (!f.size) { toast(`«${f.name}» bo'sh fayl`); continue; }
    const s = await call({ action: 'session', task_id: t.id, name: f.name, mime: f.type, size: f.size });
    if (s.err) { toast(s.err); break; }
    let id;
    try { id = await put(s.data.upload_url, f, (k) => show(t.id, `${tag}${f.name}: yuklanmoqda ${Math.round(k * 100)}%`, 0.05 + k * 0.85)); }
    catch (e) { toast(`«${f.name}» yuklanmadi: ${e.message}`); continue; }
    show(t.id, `${tag}${f.name}: saqlanmoqda…`, 0.95);
    const d = await call({ action: 'done', task_id: t.id, file_id: id });
    if (d.err) { toast(d.err); continue; }
    toast(`«${f.name}» biriktirildi`);
    refreshList(t.id);
  }
  show(t.id, '');
  refreshList(t.id);
}
/** Ro'yxatni hozir ekranda turgan bo'limda yangilaydi (ekran orada qayta chizilgan bo'lishi mumkin). */
function refreshList(taskId) { const el = document.getElementById('files_' + taskId); if (el && el._load) el._load(); }

/** Topshiriq ichidagi «Hujjatlar» bo'limi. */
export function Files(t) {
  const list = h('div', { class: 'log', id: 'files_' + t.id }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const u = UP.get(t.id);
  const status = h('div', { class: 'upl', id: 'upl_' + t.id, role: 'status', style: u ? '' : 'display:none' },
    h('div', { class: 'between' }, h('span', { class: 'upltext' }, u ? u.text : ''), h('span', { class: 'spin', 'aria-hidden': 'true' })),
    h('div', { class: 'bar' }, h('div', { style: `width:${u ? Math.round(u.k * 100) : 0}%` })));
  const load = async () => {
    const { data } = await sb.from('attachments').select('*').eq('task_id', t.id).order('created_at');
    const rows = data || [];
    list.replaceChildren(...(rows.length ? rows.map((a) => h('div', { class: 'filerow' },
      h('a', { href: a.url, target: '_blank', rel: 'noopener', class: 'filelink' }, icon('file', 20),
        h('span', { style: 'min-width:0' }, h('b', {}, a.name), h('small', { class: 't-meta', style: 'display:block' }, [size(a.size_bytes), nameOf(a.uploader_id, true), fmtDateTime(a.created_at)].filter(Boolean).join(' · ')))),
      (a.uploader_id === S.me.id || S.me.is_admin) && h('button', { class: 'xbtn sm', type: 'button', 'aria-label': `«${a.name}» faylini olib tashlash`, onclick: async () => {
        if (!await confirmBox({ title: 'Fayl olib tashlansinmi?', text: 'U topshiriqdan chiqadi va Drive savatiga o\'tadi (30 kun turadi).', ok: 'Olib tashlash' })) return;
        const r = await call({ action: 'remove', task_id: t.id, attachment_id: a.id });
        if (r.err) { toast(r.err); return; } refreshList(t.id);
      } }, '×'))) : [h('div', { class: 't-meta' }, 'Hujjat biriktirilmagan.')]));
  };
  list._load = load;
  load();

  const input = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: () => { const files = [...input.files]; input.value = ''; if (files.length) uploadAll(t, files); } });
  const btn = h('button', { class: 'btn ghost', type: 'button', id: 'uplbtn_' + t.id, disabled: !!u, onclick: () => input.click() }, u ? 'Yuklanmoqda…' : '+ Fayl biriktirish');

  return [h('div', { class: 'section' }, h('h2', {}, 'Hujjatlar')),
    h('section', { class: 'card' }, list,
      driveOn() ? [input, btn, status]
        : h('div', { class: 't-meta' }, S.me.is_admin ? 'Fayl biriktirish uchun avval Google Drive\'ni ulang: Yana → Admin panel.' : 'Fayl biriktirish hali yoqilmagan. Admin Google Drive\'ni ulashi kerak.'))];
}

/** Admin paneldagi Google Drive kartochkasi. */
export function DriveCard() {
  const d = S.settings.drive || {};
  const connect = async (e) => {
    e.target.disabled = true;
    const r = await call({ action: 'start' });
    if (r.err) { toast(r.err); e.target.disabled = false; return; }
    location.href = r.data.url;
  };
  return [h('div', { class: 'section' }, h('h2', {}, 'Google Drive')),
    h('section', { class: 'card' },
      d.connected
        ? [h('div', { class: 'between' }, h('b', {}, 'Ulangan'), h('span', { class: 'chip green' }, d.email || 'Drive')),
          h('div', { class: 't-meta' }, 'Biriktirilgan fayllar shu hisobning «Devon fayllari» papkasiga tushadi. Dastur faqat o\'zi yaratgan fayllarni ko\'radi, Drive\'dagi boshqa fayllaringizga kira olmaydi.'),
          d.folder_url && h('a', { href: d.folder_url, target: '_blank', rel: 'noopener', class: 'btn ghost' }, 'Papkani ochish'),
          h('button', { class: 'btn danger small', type: 'button', onclick: async () => {
            if (!await confirmBox({ title: 'Drive uzilsinmi?', text: 'Yuklangan fayllar Drive\'da qoladi, lekin yangi fayl biriktirib bo\'lmaydi.', ok: 'Uzish' })) return;
            const r = await call({ action: 'disconnect' }); if (r.err) { toast(r.err); return; }
            await loadBase(); toast('Drive uzildi'); bus.render();
          } }, 'Uzish')]
        : [h('div', { class: 'between' }, h('b', {}, 'Ulanmagan'), d.error && h('span', { class: 'chip red' }, 'Xato')),
          d.error && h('div', { class: 'err' }, d.error),
          h('div', { class: 't-meta' }, 'Ulash tugmasi Google sahifasini ochadi. U yerda hisobingizni tanlab, ruxsat berasiz va dasturga qaytasiz.'),
          h('button', { class: 'btn', type: 'button', onclick: connect }, 'Google Drive\'ni ulash')])];
}

/** Google'dan qaytgandagi natija (manzildagi ?drive=…). */
export function driveReturn() {
  const p = new URLSearchParams(location.search), v = p.get('drive');
  if (!v) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const MSG = { ulandi: 'Google Drive ulandi', bekor: 'Ulash bekor qilindi', muddat: 'Vaqt o\'tib ketdi, qaytadan urinib ko\'ring', xato: 'Google ruxsat bermadi', kalit: 'Google kalit bermadi. Qaytadan ulab ko\'ring', papka: 'Papka yaratib bo\'lmadi' };
  setTimeout(() => toast(MSG[v] || 'Drive: ' + v), 1600);
}
