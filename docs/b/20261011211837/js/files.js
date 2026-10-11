import { sb, S, bus, h, icon, toast, confirmBox, fmtDateTime, nameOf, loadBase, SUPABASE_URL, SUPABASE_KEY } from './core.js';

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
// ---------- Faylni dastur ichida ko'rish ----------
const OFFICE = ['doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'];
/** 'rasm' | 'pdf' | 'ofis' | null (dastur ichida ko'rsatib bo'lmaydi) */
function kindOf(a) {
  const mime = a.mime || '', ext = (a.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'rasm';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  return OFFICE.includes(ext) ? 'ofis' : null;
}
let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  }
  return pdfjs;
}
async function openFile(a) {
  const kind = kindOf(a);
  const body = h('div', { class: 'vbody' }, h('div', { class: 'vwait' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), kind === 'ofis' ? 'Hujjat ko\'rishga tayyorlanmoqda. Birinchi marta bir necha soniya oladi…' : 'Ochilmoqda…'));
  let closed = false, url = null, zoom = 1;
  const close = () => { closed = true; ov.remove(); if (url) URL.revokeObjectURL(url); };
  const setZoom = (z) => { zoom = Math.min(3, Math.max(1, z)); body.style.setProperty('--z', zoom); zlabel.textContent = Math.round(zoom * 100) + '%'; };
  const zlabel = h('span', { class: 'vz' }, '100%');
  const ov = h('div', { class: 'overlay viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': a.name },
    h('div', { class: 'vhead' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Yopish', onclick: close }, icon('back', 20)),
      h('b', { class: 'vname' }, a.name),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Kichraytirish', onclick: () => setZoom(zoom - 0.5) }, '−'), zlabel,
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Kattalashtirish', onclick: () => setZoom(zoom + 0.5) }, '+')),
    body,
    h('div', { class: 'vfoot' }, h('a', { class: 'btn ghost small', href: a.url, target: '_blank', rel: 'noopener' }, 'Drive\'da ochish'), h('button', { class: 'btn small', type: 'button', onclick: close }, 'Yopish')));
  document.body.append(ov);
  const failed = (msg) => { if (!closed) body.replaceChildren(h('div', { class: 'vwait' }, h('b', {}, 'Ochib bo\'lmadi'), msg, h('a', { class: 'btn', href: a.url, target: '_blank', rel: 'noopener' }, 'Drive\'da ochish'))); };
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/fayl`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${S.session ? S.session.access_token : ''}` }, body: JSON.stringify({ attachment_id: a.id }) });
    if (!r.ok) { let m = 'Server javob bermadi.'; try { m = (await r.json()).error || m; } catch (e) { /* matn yo'q */ } failed(m); return; }
    const blob = await r.blob();
    if (closed) return;
    if (kind === 'rasm') {
      url = URL.createObjectURL(blob);
      body.replaceChildren(h('img', { class: 'vimg', src: url, alt: a.name }));
      return;
    }
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    if (closed) return;
    const pages = h('div', { class: 'vpages' }); body.replaceChildren(pages);
    const total = doc.numPages, max = Math.min(total, 80), dpr = Math.min(2, window.devicePixelRatio || 1), width = Math.max(320, body.clientWidth - 16);
    for (let n = 1; n <= max && !closed; n++) {
      const page = await doc.getPage(n), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = h('canvas', { class: 'vpage', width: Math.floor(vp.width), height: Math.floor(vp.height), 'aria-label': `${n}-sahifa` });
      pages.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
    pages.append(h('div', { class: 't-meta', style: 'text-align:center;padding:8px' }, total > max ? `Birinchi ${max} sahifa ko'rsatildi (jami ${total}). To'lig'ini Drive'da oching.` : `Jami ${total} sahifa`));
  } catch (e) { failed('Faylni ko\'rsatishda xato: ' + (e && e.message ? e.message : 'noma\'lum')); }
}

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
      h(kindOf(a) ? 'button' : 'a', kindOf(a) ? { type: 'button', class: 'filelink plainbtn', onclick: () => openFile(a) } : { href: a.url, target: '_blank', rel: 'noopener', class: 'filelink' }, icon('file', 20),
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
  const z = S.settings.zaxira || {};
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
          h('div', { class: 'between', style: 'border-top:1px solid var(--soft);padding-top:10px' }, h('b', {}, 'Zaxira nusxa'), h('span', { class: 't-meta' }, z.at ? fmtDateTime(z.at) : 'hali olinmagan')),
          h('div', { class: 't-meta' }, 'Har kuni soat 23:00 da hamma ma\'lumot Excel fayl bo\'lib «Zaxira nusxalar» papkasiga tushadi. Oxirgi 90 kunlik fayllar saqlanadi, eskilari Drive savatiga o\'tadi.'),
          h('div', { class: 'row' },
            z.folder_url && h('a', { href: z.folder_url, target: '_blank', rel: 'noopener', class: 'btn ghost small' }, 'Zaxiralarni ochish'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => {
              e.target.disabled = true; e.target.textContent = 'Olinmoqda…';
              const r = await call({ action: 'backup' });
              if (r.err) { toast(r.err); e.target.disabled = false; e.target.textContent = 'Hozir zaxiralash'; return; }
              await loadBase(); toast('Zaxira nusxa olindi'); bus.render();
            } }, 'Hozir zaxiralash')),
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
