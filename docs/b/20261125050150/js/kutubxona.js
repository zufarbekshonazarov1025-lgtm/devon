import { sb, S, bus, h, icon, toast, ask, confirmBox, fmtDate, fmtDateTime, Head, BackHead, Empty, go } from './core.js';

// ===== Devon Kutubxona: kompaniyaning hamma hujjatlari bitta joyda =====
const FN = 'kutubxona';
const MCP_URL = 'https://wjqxqswmpxsaodcnjsrf.supabase.co/functions/v1/kutubxona/mcp';
const PAGE_URL = 'https://zufarbekshonazarov1025-lgtm.github.io/devon/k.html';
export const K = { tab: 'hujjat', bolim: 'all', q: '', bolimlar: [], kiruvchi: 0 };

const HOLAT = { kiruvchi: ['Kiruvchi', 'amber'], qoralama: ['Qoralama', 'grey'], korib_chiqishda: ["Ko'rib chiqishda", 'blue'], tasdiqlangan: ['Tasdiqlangan', 'green'], eskirgan: ['Eskirgan', 'grey'] };
const MANBA = { devon: 'Devon', havola: 'Havola orqali', ai: 'AI', bot: 'Telegram bot', kochirildi: 'Eski katalogdan' };
const TUR = { korish: "Ko'rish", qoshish: "Ko'rish va qo'shish", yuklash: 'Yuklash qutisi', bitta: 'Bitta hujjat' };
const AMAL = { kirdi: 'havolani ochdi', qidirdi: 'qidirdi', oqidi: "o'qidi", qoshdi: "qo'shdi", yangiladi: 'yangiladi', yangi_versiya: 'yangi versiya yukladi', yuklab_oldi: 'yuklab oldi', tasdiqladi: 'tasdiqladi', rad_etdi: 'rad etdi', ochirdi: "o'chirdi", kalit_yaratdi: 'AI kaliti yaratdi', havola_yaratdi: 'havola yaratdi', havola_yopdi: 'havolani yopdi', ozgartirdi: "o'zgartirdi" };
const AKTOR = { foydalanuvchi: '👤', havola: '🔗', ai: '🤖', bot: '✈️', tizim: '⚙️' };

const size = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const chip = (txt, cls) => h('span', { class: 'chip ' + cls }, txt);
async function call(body) {
  const { data, error } = await sb.functions.invoke(FN, { body });
  if (!error) return { data };
  let msg = 'Server bilan bog\'lanib bo\'lmadi';
  try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* matn yo'q */ }
  return { err: msg };
}
const log = (amal, hujjat_id = null, tafsilot = null) => sb.from('kutubxona_jurnal').insert({ aktor_turi: 'foydalanuvchi', aktor: S.me.short_name, amal, hujjat_id, tafsilot }).then(() => {});
async function copy(text, okMsg = 'Nusxa olindi') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) { await ask({ title: 'Nusxa oling', label: 'Belgilab, nusxa oling', value: text, required: false, ok: 'Yopish' }); }
}

// ---------- bo'limlar ----------
async function loadBolimlar() {
  const { data } = await sb.from('kutubxona_bolimlar').select('*').order('tartib');
  K.bolimlar = data || [];
  return K.bolimlar;
}
const bolimById = (id) => K.bolimlar.find((b) => b.id === id);
function bolimName(id) {
  const b = bolimById(id); if (!b) return "Bo'limsiz";
  const o = bolimById(b.ota_id); return o ? `${o.nom} / ${b.nom}` : b.nom;
}
const isSecret = (id) => { const b = bolimById(id); return !!b && (b.maxfiy || !!bolimById(b.ota_id)?.maxfiy); };
function bolimOptions(selected, withNone = true) {
  const tops = K.bolimlar.filter((b) => !b.ota_id);
  const opts = [];
  if (withNone) opts.push(h('option', { value: '' }, "Bo'limsiz"));
  for (const t of tops) {
    opts.push(h('option', { value: t.id, selected: t.id === selected }, t.nom + (t.maxfiy ? ' 🔒' : '')));
    for (const c of K.bolimlar.filter((b) => b.ota_id === t.id)) opts.push(h('option', { value: c.id, selected: c.id === selected }, `   ${t.nom} / ${c.nom}` + (isSecret(c.id) ? ' 🔒' : '')));
  }
  return opts;
}

// ---------- yuklash ----------
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
/** Fayllarni kutubxonaga yuklaydi. extra: { bolim_id, tavsif, teglar } yoki { hujjat_id, izoh } (yangi versiya). */
async function upload(files, extra, onState) {
  const done = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], tag = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
    if (!f.size) { toast(`«${f.name}» bo'sh fayl`); continue; }
    onState(`${tag}${f.name}: tayyorlanmoqda…`, 0.03);
    const s = await call({ action: 'session', name: f.name, mime: f.type, size: f.size });
    if (s.err) { toast(s.err); break; }
    let id;
    try { id = await put(s.data.upload_url, f, (k) => onState(`${tag}${f.name}: yuklanmoqda ${Math.round(k * 100)}%`, 0.05 + k * 0.8)); }
    catch (e) { toast(`«${f.name}» yuklanmadi: ${e.message}`); continue; }
    onState(`${tag}${f.name}: matni o'qilmoqda…`, 0.9);
    const d = await call({ action: 'done', file_id: id, ...extra, nom: files.length === 1 ? extra.nom : undefined });
    if (d.err) { toast(d.err); continue; }
    done.push(d.data.hujjat);
  }
  onState('', 0);
  return done;
}
function progressBox() {
  const text = h('span', {}), bar = h('div', { style: 'width:0%' });
  const box = h('div', { class: 'upl', role: 'status', style: 'display:none' }, h('div', { class: 'between' }, text, h('span', { class: 'spin', 'aria-hidden': 'true' })), h('div', { class: 'bar' }, bar));
  box.set = (t, k) => { box.style.display = t ? '' : 'none'; text.textContent = t; bar.style.width = `${Math.round(k * 100)}%`; };
  return box;
}

function sheet(title, ...kids) {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', style: 'max-height:92vh;overflow:auto' }, h('h2', {}, title), ...kids));
  document.body.append(ov);
  return close;
}

function addSheet() {
  if (!(S.settings.drive && S.settings.drive.connected)) { toast("Avval Google Drive'ni ulang: Yana → Admin panel"); return; }
  const sel = h('select', { class: 'input', id: 'kbolim' }, bolimOptions(K.bolim !== 'all' ? K.bolim : null));
  const nom = h('input', { class: 'input', id: 'knom', placeholder: 'Bo\'sh qolsa, fayl nomi olinadi' });
  const tavsif = h('textarea', { class: 'input', id: 'ktavsif', placeholder: 'Nima haqida, kim uchun (ixtiyoriy)' });
  const teglar = h('input', { class: 'input', id: 'kteg', placeholder: 'Masalan: buyruq, 2026, HR (vergul bilan)' });
  const prog = progressBox();
  const input = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: async () => {
    const files = [...input.files]; input.value = '';
    if (!files.length) return;
    btn.disabled = true;
    const docs = await upload(files, { bolim_id: sel.value || null, tavsif: tavsif.value.trim(), teglar: teglar.value.split(',').map((x) => x.trim()).filter(Boolean), nom: nom.value.trim() }, prog.set);
    btn.disabled = false;
    if (docs.length) { toast(`${docs.length} ta hujjat qo'shildi`); close(); bus.render(); }
  } });
  const btn = h('button', { class: 'btn', type: 'button', onclick: () => input.click() }, icon('plus', 18, '#fff', 2.5), 'Fayl tanlash');
  const close = sheet('Hujjat qo\'shish',
    h('div', { class: 'field' }, h('label', { for: 'kbolim' }, 'Bo\'lim'), sel),
    h('div', { class: 'field' }, h('label', { for: 'knom' }, 'Nomi'), nom),
    h('div', { class: 'field' }, h('label', { for: 'ktavsif' }, 'Tavsif'), tavsif),
    h('div', { class: 'field' }, h('label', { for: 'kteg' }, 'Teglar'), teglar),
    h('div', { class: 't-meta' }, 'Word, PDF, Excel, rasm — har qanday fayl. Matni avtomatik o\'qiladi va qidiruvga qo\'shiladi. Bir nechta faylni birdan tanlash mumkin.'),
    input, prog, h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Yopish'), btn));
}

// ---------- hujjatlar ro'yxati ----------
function DocCard(d) {
  const ho = HOLAT[d.holat] || [d.holat, 'grey'];
  return h('a', { class: 'card', href: `#/kutubxona/h/${d.id}`, style: 'text-decoration:none;color:inherit' },
    h('div', { class: 'between', style: 'align-items:flex-start' },
      h('div', { style: 'display:flex;gap:10px;min-width:0' }, icon('file', 22, 'var(--brand)'),
        h('div', { style: 'min-width:0' }, h('div', { class: 't-title' }, d.nom),
          h('div', { class: 't-meta' }, [bolimName(d.bolim_id) + (isSecret(d.bolim_id) ? ' 🔒' : ''), fmtDate(d.updated_at), size(d.hajm)].filter(Boolean).join(' · ')))),
      d.holat !== 'tasdiqlangan' && chip(ho[0], ho[1])),
    d.parcha ? h('div', { class: 't-meta', style: 'font-size:13px', html: esc(d.parcha).replace(/«/g, '<b>').replace(/»/g, '</b>') })
      : d.tavsif ? h('div', { class: 't-meta', style: 'font-size:13px' }, d.tavsif) : null,
    (!d.ishonchli || d.manba !== 'devon') && h('div', { class: 't-meta' }, `${MANBA[d.manba] || d.manba}${d.manba_nomi ? ' · ' + d.manba_nomi : ''}${d.ishonchli ? '' : ' · tekshirilmagan'}`));
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Eski Drive fayllarini ko'chirish (faqat admin, bir martalik) ----------
function KochirCard() {
  if (!S.me.is_admin) return null;
  const box = h('div');
  const paint = async () => {
    if (!box.isConnected && box._painted) return;
    box._painted = true;
    const [{ count }, { data: st }] = await Promise.all([
      sb.from('kutubxona_hujjatlar').select('id', { count: 'exact', head: true }).eq('manba', 'kochirildi').is('drive_file_id', null).is('deleted_at', null)
        .like('drive_url', '%google.com%').not('drive_url', 'like', '%/folders/%'),
      sb.from('app_settings').select('value').eq('key', 'kutubxona_kochir').maybeSingle()]);
    const v = (st && st.value) || {}, xato = Object.values(v.xato || {});
    const left = count || 0;
    if (v.holat === 'ishlamoqda') {
      box.replaceChildren(h('section', { class: 'card' },
        h('b', {}, 'Eski fayllar ko\'chirilmoqda'),
        h('div', { class: 't-meta' }, `Ko'chirildi: ${v.bajarildi || 0} ta · qoldi: ${Math.max(0, left - xato.length)} ta` + (xato.length ? ` · o'tmadi: ${xato.length} ta` : '')),
        h('div', { class: 't-meta' }, 'Sahifani yopsangiz ham server davom etadi.')));
      setTimeout(paint, 15000);
      return;
    }
    if (!left) { box.replaceChildren(); return; }
    const start = async (e) => {
      e.target.disabled = true;
      const { data, error } = await sb.functions.invoke('drive', { body: { action: 'kochir_start' } });
      if (error || !data || !data.url) {
        let msg = 'Server bilan bog\'lanib bo\'lmadi';
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (x) { /* matn yo'q */ }
        toast(msg); e.target.disabled = false; return;
      }
      location.href = data.url;
    };
    box.replaceChildren(h('section', { class: 'card' },
      h('b', {}, `Eski fayllar: ${left} tasi hali faqat Drive havolasi`),
      h('div', { class: 't-meta' }, 'Ko\'chirilsa, har biri Kutubxona papkasiga nusxa bo\'lib tushadi: matnini AI o\'qiydi, havola orqali kirganlar ham ochadi. Asl fayllar joyida qoladi.'),
      h('div', { class: 't-meta' }, 'Google bir martalik «faylni ko\'rish» ruxsatini so\'raydi. Ruxsat 1 soat ishlaydi va saqlanmaydi: Devon keyin ham faqat o\'zi yaratgan fayllarni ko\'radi.'),
      xato.length ? h('details', {}, h('summary', { class: 't-meta c-red' }, `O'tgan safar ${xato.length} tasi o'tmadi`), h('ul', { class: 't-meta' }, xato.map((x) => h('li', {}, x)))) : null,
      h('button', { class: 'btn', type: 'button', onclick: start }, 'Eski fayllarni ko\'chirish')));
  };
  paint();
  return box;
}

function DocsTab() {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const load = async () => {
    let rows;
    const bolim = K.bolim === 'all' ? null : K.bolim;
    if (K.q.trim()) {
      const { data } = await sb.rpc('kutubxona_qidir', { sorov: K.q.trim(), maxfiy_ok: true, bolim, lim: 50, holatlar: ['tasdiqlangan', 'korib_chiqishda', 'qoralama', 'eskirgan'] });
      const ids = (data || []).map((x) => x.id), par = new Map((data || []).map((x) => [x.id, x.parcha]));
      const { data: ds } = ids.length ? await sb.from('kutubxona_hujjatlar').select('id,nom,bolim_id,holat,manba,manba_nomi,ishonchli,tavsif,hajm,updated_at').in('id', ids) : { data: [] };
      rows = (ds || []).map((d) => ({ ...d, parcha: par.get(d.id) })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    } else {
      let s = sb.from('kutubxona_hujjatlar').select('id,nom,bolim_id,holat,manba,manba_nomi,ishonchli,tavsif,hajm,updated_at').is('deleted_at', null).neq('holat', 'kiruvchi').order('updated_at', { ascending: false }).limit(500);
      if (bolim) s = s.in('bolim_id', [bolim, ...K.bolimlar.filter((b) => b.ota_id === bolim).map((b) => b.id)]);
      rows = (await s).data || [];
    }
    box.replaceChildren(...(rows.length ? rows.map(DocCard) : [Empty(K.q ? 'Hech narsa topilmadi' : 'Bu bo\'limda hujjat yo\'q', K.q ? 'Boshqa so\'z bilan, lotin yoki kirill yozuvida urinib ko\'ring.' : '«+ Hujjat» tugmasi bilan qo\'shing.')]));
  };
  load();
  const input = h('input', { type: 'search', placeholder: 'Hujjat ichidan qidirish', 'aria-label': 'Kutubxonadan qidirish', value: K.q,
    oninput: (e) => { K.q = e.target.value; clearTimeout(input._t); input._t = setTimeout(load, 300); } });
  const tops = K.bolimlar.filter((b) => !b.ota_id);
  const fchip = (id, label) => h('button', { class: 'fchip' + (K.bolim === id ? ' on' : ''), type: 'button', 'aria-pressed': String(K.bolim === id), onclick: () => { K.bolim = id; bus.render(); } }, label);
  const subs = K.bolim !== 'all' ? K.bolimlar.filter((b) => b.ota_id === (bolimById(K.bolim)?.ota_id || K.bolim)) : [];
  return [
    KochirCard(),
    h('label', { class: 'search' }, icon('search', 18, '#56645F'), input),
    h('div', { class: 'filters' }, fchip('all', 'Hammasi'), tops.map((b) => fchip(b.id, b.nom + (b.maxfiy ? ' 🔒' : '')))),
    subs.length ? h('div', { class: 'filters' }, subs.map((b) => fchip(b.id, b.nom + (isSecret(b.id) ? ' 🔒' : '')))) : null,
    box];
}

// ---------- Kiruvchi ----------
function InboxTab() {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const load = async () => {
    const { data } = await sb.from('kutubxona_hujjatlar').select('id,nom,bolim_id,holat,manba,manba_nomi,ishonchli,tavsif,hajm,updated_at,created_at,drive_url').is('deleted_at', null).in('holat', ['kiruvchi', 'korib_chiqishda']).order('created_at', { ascending: false });
    const rows = data || [];
    K.kiruvchi = rows.length;
    box.replaceChildren(...(rows.length ? rows.map((d) => h('article', { class: 'card' },
      h('a', { href: `#/kutubxona/h/${d.id}`, style: 'color:inherit;text-decoration:none' }, h('div', { class: 't-title' }, d.nom)),
      h('div', { class: 't-meta' }, `${MANBA[d.manba] || d.manba}${d.manba_nomi ? ' · ' + d.manba_nomi : ''} · ${bolimName(d.bolim_id)} · ${fmtDateTime(d.updated_at)}`),
      d.holat === 'korib_chiqishda' && h('div', { class: 't-meta' }, 'Mavjud hujjatning yangi versiyasi — eski versiya tarixda saqlangan.'),
      d.tavsif && h('div', { class: 't-meta', style: 'font-size:13px' }, d.tavsif),
      h('div', { class: 'row' },
        d.drive_url && h('a', { class: 'btn ghost small', href: d.drive_url, target: '_blank', rel: 'noopener' }, 'Ochish'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
          if (!await confirmBox({ title: 'Rad etilsinmi?', text: 'Hujjat kutubxonaga qo\'shilmaydi (savatga o\'tadi).', ok: 'Rad etish', danger: true })) return;
          await sb.from('kutubxona_hujjatlar').update({ deleted_at: new Date().toISOString() }).eq('id', d.id);
          log('rad_etdi', d.id); toast('Rad etildi'); load();
        } }, 'Rad etish'),
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const { error } = await sb.from('kutubxona_hujjatlar').update({ holat: 'tasdiqlangan', ishonchli: true }).eq('id', d.id);
          if (error) { toast('Saqlanmadi'); return; }
          log('tasdiqladi', d.id); toast('Kutubxonaga qo\'shildi'); load();
        } }, 'Tasdiqlash')))) : [Empty('Kiruvchi bo\'sh', 'Havola, bot yoki AI orqali kelgan yangi hujjatlar shu yerda tekshiriladi.')]));
  };
  load();
  return [h('div', { class: 't-meta' }, 'Tashqi odam, bot yoki AI qo\'shgan hujjatlar tasdiqlanmaguncha shu yerda turadi va havola orqali boshqalarga ko\'rinmaydi.'), box];
}

// ---------- Havolalar ----------
const linkUrl = (l) => `${PAGE_URL}#${l.token}`;
function linkSheet() {
  const nom = h('input', { class: 'input', id: 'lnom', placeholder: 'Masalan: Otajon og\'a — HR hujjatlari' });
  const tur = h('select', { class: 'input', id: 'ltur' }, Object.entries(TUR).filter(([k]) => k !== 'bitta').map(([k, v]) => h('option', { value: k }, v)));
  const muddat = h('select', { class: 'input', id: 'lmud' }, [['7', '7 kun'], ['30', '30 kun'], ['90', '90 kun'], ['', 'Muddatsiz']].map(([v, t]) => h('option', { value: v, selected: v === '30' }, t)));
  const checks = K.bolimlar.map((b) => { const c = h('input', { type: 'checkbox', value: b.id }); return [c, h('label', { class: 'check', style: b.ota_id ? 'padding-left:24px' : '' }, c, bolimName(b.id) + (isSecret(b.id) ? ' 🔒' : ''))]; });
  const secret = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'err' });
  const close = sheet('Yangi havola',
    h('div', { class: 'field' }, h('label', { for: 'lnom' }, 'Kimga yoki nima uchun'), nom),
    h('div', { class: 'field' }, h('label', { for: 'ltur' }, 'Nima qila oladi'), tur),
    h('div', { class: 'field' }, h('label', { for: 'lmud' }, 'Muddat'), muddat),
    h('div', { class: 'field' }, h('label', {}, 'Bo\'limlar'), h('div', { class: 't-meta' }, 'Hech biri belgilanmasa — maxfiy bo\'lmagan hamma bo\'limlar ochiladi.'), checks.map((x) => x[1])),
    h('label', { class: 'check' }, secret, 'Maxfiy bo\'limlarni ham ochish 🔒'),
    err,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Bekor'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!nom.value.trim()) { err.textContent = 'Havola nomini yozing'; return; }
        const ids = checks.filter(([c]) => c.checked).map(([c]) => c.value);
        if (secret.checked && !await confirmBox({ title: 'Maxfiy bo\'limlar ochilsinmi?', text: 'Havolani olgan har kim shaxsiy hujjatlar, shartnomalar yoki moliya hujjatlarini ko\'ra oladi.', ok: 'Ha, ochilsin', danger: true })) return;
        const m = muddat.value ? new Date(Date.now() + Number(muddat.value) * 86400000).toISOString() : null;
        const { data, error } = await sb.from('kutubxona_havolalar').insert({ nom: nom.value.trim(), tur: tur.value, bolim_ids: ids, maxfiyga_ruxsat: secret.checked, muddat: m, yaratgan: S.me.id }).select().single();
        if (error) { err.textContent = 'Saqlanmadi'; return; }
        log('havola_yaratdi', null, { nom: data.nom }); close(); bus.render();
        copy(linkUrl(data), 'Havola tayyor, nusxasi olindi — endi yuborishingiz mumkin');
      } }, 'Yaratish')));
}
export async function docLink(d) {
  const { data, error } = await sb.from('kutubxona_havolalar').insert({ nom: `Bitta hujjat: ${d.nom}`, tur: 'bitta', hujjat_id: d.id, maxfiyga_ruxsat: isSecret(d.bolim_id), muddat: new Date(Date.now() + 30 * 86400000).toISOString(), yaratgan: S.me.id }).select().single();
  if (error) { toast('Havola yaratilmadi'); return; }
  log('havola_yaratdi', d.id, { nom: data.nom });
  copy(linkUrl(data), '30 kunlik havola nusxasi olindi');
}
function LinksTab() {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const load = async () => {
    const { data } = await sb.from('kutubxona_havolalar').select('*').order('created_at', { ascending: false });
    const now = Date.now();
    box.replaceChildren(...((data || []).length ? data.map((l) => {
      const expired = l.muddat && Date.parse(l.muddat) < now, on = l.faol && !expired;
      return h('article', { class: 'card' },
        h('div', { class: 'between' }, h('div', { class: 't-title' }, l.nom), on ? chip('Ochiq', 'green') : chip(expired ? 'Muddati tugagan' : 'Yopiq', 'grey')),
        h('div', { class: 't-meta' }, [TUR[l.tur], l.hujjat_id ? null : (l.bolim_ids?.length ? l.bolim_ids.map(bolimName).join(', ') : 'Hamma bo\'limlar'), l.maxfiyga_ruxsat ? 'maxfiylar ham 🔒' : null].filter(Boolean).join(' · ')),
        h('div', { class: 't-meta' }, `${l.muddat ? 'Muddat: ' + fmtDate(l.muddat) : 'Muddatsiz'} · Oxirgi kirish: ${l.oxirgi_kirish ? fmtDateTime(l.oxirgi_kirish) : 'hali yo\'q'}`),
        h('div', { class: 'row' },
          on && h('button', { class: 'btn small', type: 'button', onclick: () => copy(linkUrl(l)) }, 'Nusxa olish'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
            const patch = on ? { faol: false } : { faol: true, muddat: expired ? new Date(now + 30 * 86400000).toISOString() : l.muddat };
            await sb.from('kutubxona_havolalar').update(patch).eq('id', l.id);
            log(on ? 'havola_yopdi' : 'havola_yaratdi', null, { nom: l.nom }); load();
          } }, on ? 'Yopish' : 'Qayta ochish'),
          h('button', { class: 'xbtn sm', type: 'button', 'aria-label': 'Havolani o\'chirish', onclick: async () => {
            if (!await confirmBox({ title: 'Havola o\'chirilsinmi?', text: 'Bu havola butunlay ishlamay qoladi.', ok: 'O\'chirish', danger: true })) return;
            await sb.from('kutubxona_havolalar').delete().eq('id', l.id); load();
          } }, '×')));
    }) : [Empty('Havola yo\'q', 'Tashqi odamga kutubxonani ko\'rsatish yoki undan hujjat olish uchun havola yarating.')]));
  };
  load();
  return [h('button', { class: 'btn', type: 'button', onclick: linkSheet }, icon('plus', 18, '#fff', 2.5), 'Yangi havola'),
    h('div', { class: 't-meta' }, 'Havolani olgan odam Devon\'ga kirmaydi: unga faqat ruxsat berilgan bo\'limlar ko\'rinadi. Birinchi ochganda ismini yozadi, hamma harakati Jurnalda turadi.'), box];
}

// ---------- AI ulanishlari ----------
function keySheet() {
  const nom = h('input', { class: 'input', id: 'anom', placeholder: 'Masalan: Perplexity — Sanjar og\'a' });
  const qosh = h('input', { type: 'checkbox', checked: true }), yangila = h('input', { type: 'checkbox', checked: true }), secret = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'err' });
  const close = sheet('Yangi AI kaliti',
    h('div', { class: 'field' }, h('label', { for: 'anom' }, 'Qaysi AI, kim uchun'), nom),
    h('div', { class: 't-meta' }, 'Qidirish va o\'qish doim ochiq. Qo\'shimcha ruxsatlar:'),
    h('label', { class: 'check' }, qosh, 'Yangi hujjat qo\'shish (Kiruvchiga tushadi)'),
    h('label', { class: 'check' }, yangila, 'Hujjatni yangilash (eski versiya saqlanadi)'),
    h('label', { class: 'check' }, secret, 'Maxfiy bo\'limlarni ham ko\'rish 🔒'),
    err,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Bekor'),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        if (!nom.value.trim()) { err.textContent = 'Nom yozing'; return; }
        e.target.disabled = true;
        const huquqlar = ['qidir', 'oqi', 'royxat', ...(qosh.checked ? ['qosh'] : []), ...(yangila.checked ? ['yangila'] : [])];
        const r = await call({ action: 'kalit', nom: nom.value.trim(), huquqlar, maxfiyga_ruxsat: secret.checked });
        e.target.disabled = false;
        if (r.err) { err.textContent = r.err; return; }
        close(); bus.render(); showKey(r.data.key, nom.value.trim());
      } }, 'Yaratish')));
}
function showKey(key, nom) {
  const urlKey = `${MCP_URL}?key=${key}`;
  const line = (label, val) => h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'row' }, h('input', { class: 'input', readonly: true, value: val, style: 'font-size:12px' }), h('button', { class: 'btn ghost small', type: 'button', style: 'flex:none', onclick: () => copy(val) }, 'Nusxa')));
  const close = sheet(`Kalit tayyor: ${nom}`,
    h('div', { class: 'err' }, 'Kalit faqat hozir ko\'rinadi. Nusxa olib, AI sozlamasiga kiriting.'),
    line('Server manzili', MCP_URL), line('Kalit (API key)', key), line('Kalitli manzil (kalit maydoni bo\'lmasa)', urlKey),
    h('div', { class: 'section' }, h('h2', {}, 'Qanday ulanadi')),
    h('div', { class: 't-meta', style: 'font-size:13px;line-height:1.5' },
      h('b', {}, 'Perplexity: '), 'Settings → Connectors → + Custom connector → Remote. URL: server manzili. Authentication: API Key → kalit.', h('br'),
      h('b', {}, 'Claude: '), 'Customize → Connectors → Add custom connector. URL maydoniga kalitli manzilni qo\'ying.', h('br'),
      h('b', {}, 'ChatGPT: '), 'Settings → Apps → Advanced → Developer mode → Create app. URL: kalitli manzil, Authentication: No authentication.'),
    h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Tayyor'));
}
function AiTab() {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  const load = async () => {
    const { data } = await sb.from('kutubxona_ai_kalitlar').select('id,nom,huquqlar,maxfiyga_ruxsat,faol,oxirgi_ishlatish,created_at').order('created_at', { ascending: false });
    box.replaceChildren(...((data || []).length ? data.map((k) => h('article', { class: 'card' },
      h('div', { class: 'between' }, h('div', { class: 't-title' }, '🤖 ' + k.nom), k.faol ? chip('Faol', 'green') : chip('O\'chirilgan', 'grey')),
      h('div', { class: 't-meta' }, `Ruxsat: qidirish, o'qish${k.huquqlar.includes('qosh') ? ', qo\'shish' : ''}${k.huquqlar.includes('yangila') ? ', yangilash' : ''}${k.maxfiyga_ruxsat ? ' · maxfiylar ham 🔒' : ''}`),
      h('div', { class: 't-meta' }, `Oxirgi ishlatilgan: ${k.oxirgi_ishlatish ? fmtDateTime(k.oxirgi_ishlatish) : 'hali yo\'q'}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { await sb.from('kutubxona_ai_kalitlar').update({ faol: !k.faol }).eq('id', k.id); load(); } }, k.faol ? 'To\'xtatish' : 'Yoqish'),
        h('button', { class: 'xbtn sm', type: 'button', 'aria-label': 'Kalitni o\'chirish', onclick: async () => {
          if (!await confirmBox({ title: 'Kalit o\'chirilsinmi?', text: 'Bu AI kutubxonaga boshqa kira olmaydi.', ok: 'O\'chirish', danger: true })) return;
          await sb.from('kutubxona_ai_kalitlar').delete().eq('id', k.id); load();
        } }, '×')))) : [Empty('AI ulanmagan', 'Perplexity, Claude yoki ChatGPT uchun kalit yarating.')]));
  };
  load();
  return [S.me.is_admin ? h('button', { class: 'btn', type: 'button', onclick: keySheet }, icon('plus', 18, '#fff', 2.5), 'Yangi kalit') : null,
    h('section', { class: 'card' }, h('b', {}, 'AI uchun server manzili'), h('div', { class: 't-meta', style: 'overflow-wrap:anywhere' }, MCP_URL),
      h('div', { class: 't-meta' }, 'Har bir AI o\'z kaliti bilan ulanadi. AI qidiradi, o\'qiydi, qo\'shadi va yangilaydi, lekin hujjat o\'chira olmaydi. Kalitni istalgan payt to\'xtatish mumkin.'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => copy(MCP_URL) }, 'Manzilni nusxalash')),
    box];
}

// ---------- Jurnal ----------
function LogTab() {
  const box = h('div', { class: 'card' }, h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  (async () => {
    const { data } = await sb.from('kutubxona_jurnal').select('*, kutubxona_hujjatlar(nom)').order('qachon', { ascending: false }).limit(150);
    const rows = data || [];
    box.replaceChildren(h('div', { class: 'log' }, rows.length ? rows.map((r) => h('div', { class: 'item' },
      h('span', { class: 'who' }, `${AKTOR[r.aktor_turi] || ''} ${r.aktor || ''}`), ' ', AMAL[r.amal] || r.amal,
      r.kutubxona_hujjatlar?.nom ? [': ', h('a', { href: `#/kutubxona/h/${r.hujjat_id}` }, r.kutubxona_hujjatlar.nom)] : (r.tafsilot?.q ? `: «${r.tafsilot.q}»` : r.tafsilot?.nom ? `: ${r.tafsilot.nom}` : ''),
      h('div', { class: 'when' }, fmtDateTime(r.qachon)))) : h('div', { class: 't-meta' }, 'Hali hech narsa yozilmagan.')));
  })();
  return [box];
}

// ---------- Bo'limlarni boshqarish ----------
function bolimSheet() {
  const list = h('div', { class: 'log' });
  const paint = () => list.replaceChildren(...K.bolimlar.map((b) => h('div', { class: 'item between' },
    h('span', { style: b.ota_id ? 'padding-left:18px' : '' }, bolimName(b.id), b.maxfiy ? ' 🔒' : ''),
    h('span', { class: 'row' },
      h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        const v = await ask({ title: 'Bo\'lim nomi', label: 'Yangi nom', value: b.nom }); if (!v) return;
        await sb.from('kutubxona_bolimlar').update({ nom: v }).eq('id', b.id); await loadBolimlar(); paint(); bus.render();
      } }, 'Nomi'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        await sb.from('kutubxona_bolimlar').update({ maxfiy: !b.maxfiy }).eq('id', b.id); await loadBolimlar(); paint(); bus.render();
      } }, b.maxfiy ? 'Ochiq qilish' : 'Maxfiy 🔒')))));
  paint();
  const ota = h('select', { class: 'input', id: 'bota' }, h('option', { value: '' }, 'Asosiy bo\'lim'), K.bolimlar.filter((b) => !b.ota_id).map((b) => h('option', { value: b.id }, `${b.nom} ichida`)));
  const nom = h('input', { class: 'input', id: 'bnom', placeholder: 'Yangi bo\'lim nomi' });
  const close = sheet('Bo\'limlar', list,
    h('div', { class: 'field' }, h('label', { for: 'bnom' }, 'Yangi bo\'lim'), nom, ota),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Yopish'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!nom.value.trim()) return;
        const max = Math.max(0, ...K.bolimlar.map((b) => b.tartib || 0));
        await sb.from('kutubxona_bolimlar').insert({ nom: nom.value.trim(), ota_id: ota.value || null, tartib: ota.value ? (bolimById(ota.value).tartib || 0) + 5 : max + 10 });
        nom.value = ''; await loadBolimlar(); paint(); bus.render();
      } }, 'Qo\'shish')));
}

// ---------- asosiy ekran ----------
export function Library() {
  const view = h('main', { class: 'view' });
  const paint = () => {
    const tabs = [['hujjat', 'Hujjatlar'], ['kiruvchi', K.kiruvchi ? `Kiruvchi · ${K.kiruvchi}` : 'Kiruvchi'], ['havola', 'Havolalar'], ['ai', 'AI'], ['jurnal', 'Jurnal']];
    const body = { hujjat: DocsTab, kiruvchi: InboxTab, havola: LinksTab, ai: AiTab, jurnal: LogTab }[K.tab] || DocsTab;
    view.replaceChildren(
      Head('Hamma hujjatlar bitta joyda', 'Kutubxona', K.tab === 'hujjat' ? h('span', { class: 'row', style: 'gap:6px' },
        h('button', { class: 'btn ghost pill small', type: 'button', onclick: bolimSheet }, 'Bo\'limlar'),
        h('button', { class: 'btn pill small', type: 'button', onclick: addSheet }, '+ Hujjat')) : null),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Kutubxona bo\'limi', style: 'overflow-x:auto' }, tabs.map(([k, l]) =>
        h('button', { type: 'button', class: K.tab === k ? 'on' : '', 'aria-pressed': String(K.tab === k), style: 'white-space:nowrap', onclick: () => { K.tab = k; bus.render(); } }, l))),
      body());
  };
  if (!K.bolimlar.length) { view.append(h('div', { class: 't-meta' }, 'Yuklanmoqda…')); loadBolimlar().then(paint); } else paint();
  // Kiruvchi soni tepada ko'rinib tursin
  sb.from('kutubxona_hujjatlar').select('id', { count: 'exact', head: true }).is('deleted_at', null).in('holat', ['kiruvchi', 'korib_chiqishda']).then(({ count }) => {
    if (typeof count === 'number' && count !== K.kiruvchi) { K.kiruvchi = count; if (K.bolimlar.length) paint(); }
  });
  return view;
}

// ---------- bitta hujjat ----------
export function LibraryDoc(id) {
  const view = h('main', { class: 'view' }, BackHead('Hujjat', '#/kutubxona'), h('div', { class: 't-meta' }, 'Yuklanmoqda…'));
  (async () => {
    if (!K.bolimlar.length) await loadBolimlar();
    const { data: d } = await sb.from('kutubxona_hujjatlar').select('*').eq('id', id).maybeSingle();
    if (!d || d.deleted_at) { view.replaceChildren(BackHead('Hujjat', '#/kutubxona'), Empty('Hujjat topilmadi', 'U o\'chirilgan bo\'lishi mumkin.')); return; }
    const [{ data: vers }, { data: logs }] = await Promise.all([
      sb.from('kutubxona_versiyalar').select('*').eq('hujjat_id', id).order('versiya', { ascending: false }),
      sb.from('kutubxona_jurnal').select('*').eq('hujjat_id', id).order('qachon', { ascending: false }).limit(20)]);
    const ho = HOLAT[d.holat] || [d.holat, 'grey'];
    const upd = async (patch, amal = 'ozgartirdi') => { const { error } = await sb.from('kutubxona_hujjatlar').update(patch).eq('id', id); if (error) { toast('Saqlanmadi'); return; } log(amal, id, patch.nom ? { nom: patch.nom } : null); bus.render(); };
    const sel = h('select', { class: 'input', 'aria-label': 'Bo\'lim', onchange: () => upd({ bolim_id: sel.value || null }) }, bolimOptions(d.bolim_id));
    const prog = progressBox();
    const verInput = h('input', { type: 'file', style: 'display:none', onchange: async () => {
      const files = [...verInput.files]; verInput.value = ''; if (!files.length) return;
      const izoh = await ask({ title: 'Nima o\'zgardi?', label: 'Qisqa izoh (ixtiyoriy)', required: false, ok: 'Yuklash' });
      if (izoh === null) return;
      const r = await upload(files, { hujjat_id: id, izoh }, prog.set);
      if (r.length) { toast('Yangi versiya saqlandi'); bus.render(); }
    } });
    const text = String(d.matn || '');
    const pre = h('div', { style: 'white-space:pre-wrap;font-size:13px;line-height:1.5;max-height:340px;overflow:auto;background:var(--bg);border-radius:12px;padding:12px' }, text.slice(0, 6000) + (text.length > 6000 ? '\n\n…' : ''));
    view.replaceChildren(
      BackHead('Kutubxona', '#/kutubxona'),
      h('section', { class: 'card' },
        h('div', { class: 'between', style: 'align-items:flex-start' }, h('h1', { style: 'font-size:20px;margin:0' }, d.nom),
          h('button', { class: 'xbtn sm', type: 'button', 'aria-label': 'Nomini o\'zgartirish', onclick: async () => { const v = await ask({ title: 'Hujjat nomi', label: 'Nomi', value: d.nom }); if (v) upd({ nom: v }); } }, icon('edit', 18))),
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, chip(ho[0], ho[1]), isSecret(d.bolim_id) && chip('Maxfiy 🔒', 'red'), !d.ishonchli && chip('Tekshirilmagan', 'amber'), chip(`v${d.joriy_versiya}`, 'grey'), d.til && chip(d.til === 'kirill' ? 'Kirill yozuvi' : 'Lotin yozuvi', d.til === 'kirill' ? 'amber' : 'grey')),
        h('div', { class: 'field' }, h('label', {}, 'Bo\'lim'), sel),
        h('div', { class: 't-meta' }, [`${MANBA[d.manba] || d.manba}${d.manba_nomi ? ' · ' + d.manba_nomi : ''}`, `qo'shilgan ${fmtDateTime(d.created_at)}`, `yangilangan ${fmtDateTime(d.updated_at)}`, size(d.hajm)].filter(Boolean).join(' · ')),
        d.tavsif && h('div', { style: 'font-size:14px' }, d.tavsif),
        d.teglar?.length ? h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, d.teglar.map((t) => chip('#' + t, 'grey'))) : null,
        h('div', { class: 'row', style: 'flex-wrap:wrap' },
          d.drive_url && h('a', { class: 'btn small', href: d.drive_url, target: '_blank', rel: 'noopener' }, 'Drive\'da ochish'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => docLink(d) }, 'Havola berish'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => verInput.click() }, 'Yangi versiya')),
        verInput, prog,
        d.holat !== 'tasdiqlangan'
          ? h('button', { class: 'btn', type: 'button', onclick: () => upd({ holat: 'tasdiqlangan', ishonchli: true }, 'tasdiqladi') }, 'Tasdiqlash')
          : h('button', { class: 'btn ghost small', type: 'button', onclick: () => upd({ holat: 'eskirgan' }) }, 'Eskirgan deb belgilash')),
      h('div', { class: 'section' }, h('h2', {}, 'Tavsif va teglar')),
      h('section', { class: 'card' }, h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { const v = await ask({ title: 'Tavsif', label: 'Nima haqida', value: d.tavsif || '', required: false }); if (v !== null) upd({ tavsif: v || null }); } }, 'Tavsifni o\'zgartirish'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { const v = await ask({ title: 'Teglar', label: 'Vergul bilan', value: (d.teglar || []).join(', '), required: false }); if (v !== null) upd({ teglar: v.split(',').map((x) => x.trim()).filter(Boolean) }); } }, 'Teglar'))),
      h('div', { class: 'section' }, h('h2', {}, 'Matn'), h('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'O\'qilmoqda…';
        const r = await call({ action: 'matn', hujjat_id: id });
        if (r.err) { toast(r.err); e.target.disabled = false; e.target.textContent = 'Qayta o\'qish'; return; }
        toast('Matn yangilandi'); bus.render();
      } }, 'Qayta o\'qish')),
      h('section', { class: 'card' }, text ? [h('div', { class: 't-meta' }, `${text.length.toLocaleString('uz')} belgi · qidiruv va AI shu matndan foydalanadi`), pre] : h('div', { class: 't-meta' }, 'Bu fayldan matn olinmagan. «Qayta o\'qish»ni bosib ko\'ring.')),
      (vers || []).length ? [h('div', { class: 'section' }, h('h2', {}, 'Oldingi versiyalar')),
        h('section', { class: 'card' }, h('div', { class: 'log' }, vers.map((v) => h('div', { class: 'item between' },
          h('span', {}, h('b', {}, `v${v.versiya}`), ` · ${v.kim || ''} · ${fmtDateTime(v.created_at)}`, v.izoh ? h('div', { class: 't-meta' }, `Keyingisida: ${v.izoh}`) : null),
          v.drive_url && h('a', { class: 'btn ghost small', href: v.drive_url, target: '_blank', rel: 'noopener' }, 'Ochish')))))] : null,
      (logs || []).length ? [h('div', { class: 'section' }, h('h2', {}, 'Tarix')),
        h('section', { class: 'card' }, h('div', { class: 'log' }, logs.map((r) => h('div', { class: 'item' }, h('span', { class: 'who' }, `${AKTOR[r.aktor_turi] || ''} ${r.aktor || ''}`), ' ', AMAL[r.amal] || r.amal, h('div', { class: 'when' }, fmtDateTime(r.qachon))))))] : null,
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!await confirmBox({ title: 'Hujjat o\'chirilsinmi?', text: 'Kutubxonadan chiqadi. Fayl Google Drive\'da qoladi.', ok: 'O\'chirish', danger: true })) return;
        await sb.from('kutubxona_hujjatlar').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        log('ochirdi', id); toast('O\'chirildi'); go('#/kutubxona');
      } }, 'Kutubxonadan o\'chirish'));
  })();
  return view;
}
