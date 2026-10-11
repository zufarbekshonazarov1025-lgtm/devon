import { sb, S, bus, h, icon, toast, ask, confirmBox, today, fmtDate, fmtDateTime, dayOf, isOpen, onTime, nameOf, STATUS,
  go, Head, BackHead, Empty, addDays, mondayOf, monthStart, monthEnd, fmtDay, monthName, hhmm,
  owner, approverOf, loadAll, loadPlan, loadReports, loadRequests, loadTasks, ping } from './core.js';

const R = { tab: 'kunlik', date: null, range: 'oy' };
const iAmOwner = () => owner().id === S.me.id;
const inRange = (d, a, b) => d && d >= a && d <= b;

// ---------- Kichik shakl oynasi ----------
function sheetForm({ title, fields, ok = 'Yuborish' }) {
  return new Promise((resolve) => {
    const els = fields.map((f) => (f.type === 'select'
      ? (() => { const el = h('select', { class: 'input', id: 'sf_' + f.id }, f.options.map(([v, l]) => h('option', { value: v }, l))); el.value = f.value; return el; })()
      : f.type === 'textarea'
      ? h('textarea', { class: 'input', id: 'sf_' + f.id, value: f.value || '', placeholder: f.placeholder || '' })
      : h('input', { class: 'input', id: 'sf_' + f.id, type: f.type || 'text', value: f.value || '', min: f.min, placeholder: f.placeholder || '' })));
    const err = h('div', { class: 'err' });
    const close = (v) => { ov.remove(); resolve(v); };
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(null); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title),
        fields.map((f, i) => h('div', { class: 'field' }, h('label', { for: 'sf_' + f.id }, f.label, f.required && h('span', { class: 'req' }, ' *')), els[i])),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, 'Bekor'),
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const out = {};
            for (let i = 0; i < fields.length; i++) {
              const v = els[i].value.trim();
              if (fields[i].required && !v) { err.textContent = `«${fields[i].label}» to'ldirilishi shart`; return; }
              out[fields[i].id] = v;
            }
            close(out);
          } }, ok))));
    document.body.append(ov); els[0].focus();
  });
}

// ---------- Hujjatlar (reja / hisobot) ----------
export function findDoc(docType, period, start) {
  return S.reports.find((r) => r.owner_id === owner().id && r.doc_type === docType && r.period === period && r.period_start === start) || null;
}
function docChip(r) {
  if (!r || r.status === 'qoralama') return h('span', { class: 'chip grey' }, 'Yuborilmagan');
  if (r.status === 'yuborildi') return h('span', { class: 'chip amber' }, 'Tasdiq kutilmoqda');
  if (r.status === 'tasdiqlandi') return h('span', { class: 'chip green' }, 'Tasdiqlandi');
  return h('span', { class: 'chip red' }, 'Qaytarildi');
}
const DOC_NAME = { 'reja:kunlik': 'Kunlik reja', 'hisobot:kunlik': 'Kunlik hisobot', 'reja:haftalik': 'Haftalik reja', 'hisobot:haftalik': 'Haftalik hisobot', 'reja:oylik': 'Oylik reja', 'hisobot:oylik': 'Oylik hisobot' };
export const docName = (r) => DOC_NAME[`${r.doc_type}:${r.period}`] || 'Hujjat';
export function docPeriod(r) {
  if (r.period === 'kunlik') return fmtDay(r.period_start);
  if (r.period === 'oylik') return monthName(r.period_start);
  return `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`;
}

/** Vaqtida yuborildimi: reja 07:30 gacha (o'sha kuni), hisobot 19:30 gacha. */
function sentOnTime(docType, period, start, end) {
  const cfg = S.settings.hisobot || {};
  const now = new Date(), d = today(), t = hhmm(now);
  if (period !== 'kunlik') return d <= end;
  if (docType === 'reja') return d < start || (d === start && t <= (cfg.reja_vaqti || '07:30'));
  return d < start || (d === start && t <= (cfg.hisobot_vaqti || '19:30'));
}

async function sendDoc({ docType, period, start, end, body, data = {} }) {
  const me = S.me.id, ap = approverOf(me);
  const ex = findDoc(docType, period, start);
  const now = new Date().toISOString();
  const flag = sentOnTime(docType, period, start, end);
  let res;
  if (ex) res = await sb.from('reports').update({ body, data, status: 'yuborildi', sent_at: now, on_time: ex.on_time == null ? flag : ex.on_time, approver_comment: null }).eq('id', ex.id).select().single();
  else res = await sb.from('reports').insert({ owner_id: me, doc_type: docType, period, period_start: start, period_end: end, body, data, status: 'yuborildi', sent_at: now, on_time: flag }).select().single();
  if (res.error) { toast('Yuborib bo\'lmadi: ' + res.error.message); return false; }
  const rep = res.data;
  const pending = S.requests.find((r) => r.report_id === rep.id && r.status === 'kutilmoqda' && r.kind === docType);
  if (!pending && ap) {
    await sb.from('requests').insert({ kind: docType, report_id: rep.id, requester_id: me, approver_id: ap.id, title: `${docName(rep)} · ${docPeriod(rep)}` });
    ping(ap.id, 'tasdiq', `${docName(rep)} yuborildi`, docPeriod(rep), 'report', rep.id);
  }
  await Promise.all([loadReports(), loadRequests()]);
  toast(flag ? 'Yuborildi' : 'Yuborildi (belgilangan vaqtdan keyin)'); bus.render(); return true;
}

// ---------- So'rovlar ----------
export const pendingForMe = () => S.requests.filter((r) => r.status === 'kutilmoqda' && r.approver_id === S.me.id);
export const mySentRequests = () => S.requests.filter((r) => r.requester_id === S.me.id);
const REQ_LABEL = { reja: 'Tasdiq · reja', hisobot: 'Tasdiq · hisobot', qaror: 'Qaror kerak', muddat: 'Muddatni ko\'chirish so\'rovi', hisobot_tuzatish: 'Hisobotni tuzatish so\'rovi' };
const REQ_STATE = { kutilmoqda: ['Kutilmoqda', 'amber'], tasdiqlandi: ['Tasdiqlandi', 'green'], rad: ['Rad etildi', 'red'] };

async function respond(req, approve, response) {
  const now = new Date().toISOString(), me = S.me.id;
  if (req.kind === 'reja' || req.kind === 'hisobot') {
    const { error } = await sb.from('reports').update({ status: approve ? 'tasdiqlandi' : 'qaytarildi', approver_id: me, approved_at: approve ? now : null, approver_comment: response || null }).eq('id', req.report_id);
    if (error) { toast('Saqlab bo\'lmadi'); return; }
  }
  if (req.kind === 'hisobot_tuzatish' && approve) {
    const rep = S.reports.find((r) => r.id === req.report_id);
    if (rep) {
      const changes = [...(rep.changes || []), { at: now, old: rep.body, new: req.payload.new_body, reason: req.payload.reason, by: req.requester_id, approved_by: me }];
      const { error } = await sb.from('reports').update({ body: req.payload.new_body, changes }).eq('id', rep.id);
      if (error) { toast('Saqlab bo\'lmadi'); return; }
    }
  }
  if (req.kind === 'muddat' && approve) {
    const t = S.tasks.find((x) => x.id === req.task_id);
    if (t) {
      const { error } = await sb.from('tasks').update({ due_date: req.payload.new_due, reschedule_count: (t.reschedule_count || 0) + 1, original_due_date: t.original_due_date || t.due_date }).eq('id', t.id);
      if (error) { toast('Muddatni o\'zgartirib bo\'lmadi'); return; }
    }
  }
  const { error } = await sb.from('requests').update({ status: approve ? 'tasdiqlandi' : 'rad', response: response || null, responded_at: now }).eq('id', req.id);
  if (error) { toast('Saqlab bo\'lmadi'); return; }
  ping(req.requester_id, 'javob', approve ? 'So\'rovingiz tasdiqlandi' : 'So\'rovingiz qaytarildi', req.title, 'request', req.id);
  await loadAll(); toast(approve ? 'Tasdiqlandi' : 'Qaytarildi'); bus.render();
}

export function RequestCard(r) {
  const rep = r.report_id ? S.reports.find((x) => x.id === r.report_id) : null;
  const task = r.task_id ? S.tasks.find((x) => x.id === r.task_id) : null;
  const decline = async (title, label) => { const v = await ask({ title, label, ok: 'Yuborish' }); if (v != null) respond(r, false, v); };
  let detail = null, buttons;
  if (r.kind === 'reja' && rep) {
    const items = planItems(rep.period_start);
    detail = rep.period === 'kunlik'
      ? h('div', { class: 'text' }, items.length ? items.map(line).join('\n') : 'Reja bandlari kiritilmagan.')
      : h('div', { class: 'text' }, rep.body || '');
  }
  if (r.kind === 'hisobot' && rep) detail = h('div', { class: 'text' }, rep.body || '');
  if (r.kind === 'hisobot_tuzatish') detail = h('div', {}, h('div', { class: 't-meta' }, 'Sabab'), h('div', { class: 'text' }, r.payload.reason), h('div', { class: 't-meta', style: 'margin-top:8px' }, 'Hozirgi matn'), h('div', { class: 'text' }, rep ? rep.body : ''), h('div', { class: 't-meta', style: 'margin-top:8px' }, 'Yangi matn'), h('div', { class: 'text' }, r.payload.new_body));
  if (r.kind === 'muddat') detail = h('div', { class: 'text' }, `${fmtDate(r.payload.old_due)} → ${fmtDate(r.payload.new_due)}\nSabab: ${r.payload.reason}`);
  if (r.kind === 'qaror') detail = r.body ? h('div', { class: 'text' }, r.body) : null;

  if (r.kind === 'qaror') buttons = h('button', { class: 'btn', onclick: async () => { const v = await ask({ title: 'Javobingiz', label: 'Qaror yoki ko\'rsatma', ok: 'Javob berish' }); if (v != null) respond(r, true, v); } }, 'Javob berish');
  else if (r.kind === 'muddat') buttons = h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => respond(r, true, null) }, 'Ruxsat'), h('button', { class: 'btn ghost', onclick: () => decline('Rad etish sababi', 'Nega ruxsat berilmadi') }, 'Rad etish'));
  else if (r.kind === 'hisobot_tuzatish') buttons = h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => respond(r, true, null) }, 'Tasdiqlash'), h('button', { class: 'btn ghost', onclick: () => decline('Rad etish sababi', 'Nega rad etildi') }, 'Rad etish'));
  else buttons = h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => respond(r, true, null) }, 'Tasdiqlash'), h('button', { class: 'btn ghost', onclick: () => decline('Izoh yozing', 'Nimani o\'zgartirish kerak') }, 'Izoh yozish'));

  return h('article', { class: 'card' },
    h('div', {},
      h('div', { class: 't-meta c-amber', style: 'font-weight:700' }, REQ_LABEL[r.kind]),
      h('div', { class: 't-title', style: 'margin-top:4px' }, r.title),
      h('div', { class: 't-meta', style: 'margin-top:4px' }, `${nameOf(r.requester_id, true)} yubordi · ${fmtDateTime(r.created_at)}`),
      task && h('a', { href: `#/ish/${task.id}`, class: 't-meta', style: 'display:block;margin-top:4px;color:var(--brand);font-weight:600' }, `Topshiriq №${task.seq}: ${task.title}`)),
    detail, buttons);
}

/** Yuborilgan so'rov bosilganda nima ochilishi. */
function openTarget(r) {
  const rep = r.report_id ? S.reports.find((x) => x.id === r.report_id) : null;
  if (rep) {
    // Qaytarilgan kunlik hujjat: tuzatib qayta yuborish mumkin bo'lgan joyga olib boradi
    if (rep.period === 'kunlik' && rep.owner_id === S.me.id && ['qaytarildi', 'qoralama'].includes(rep.status)) { R.tab = 'kunlik'; R.date = rep.period_start; go('#/hisobot'); return; }
    go(`#/hisobot/${rep.id}`); return;
  }
  if (r.task_id && S.tasks.some((t) => t.id === r.task_id)) { go(`#/ish/${r.task_id}`); return; }
  toast('Bu so\'rovga bog\'langan sahifa yo\'q');
}

export function SentCard(r) {
  let [label, cls] = REQ_STATE[r.status];
  if (r.status === 'rad' && (r.kind === 'reja' || r.kind === 'hisobot')) label = 'Qaytarildi';
  if (r.kind === 'qaror' && r.status === 'tasdiqlandi') label = 'Javob berildi';
  const rep = r.report_id ? S.reports.find((x) => x.id === r.report_id) : null;
  const fixable = rep && rep.owner_id === S.me.id && rep.status === 'qaytarildi' && r.status === 'rad';
  const linked = !!(rep || (r.task_id && S.tasks.some((t) => t.id === r.task_id)));
  return h(linked ? 'button' : 'article', { class: 'card' + (linked ? ' tap' : ''), type: linked ? 'button' : null, onclick: linked ? () => openTarget(r) : null },
    h('div', { class: 'between' }, h('span', { class: 't-meta', style: 'font-weight:700' }, REQ_LABEL[r.kind]), h('span', { class: `chip ${cls}` }, label)),
    h('div', { class: 't-title' }, r.title),
    r.kind === 'muddat' && h('div', { class: 't-meta' }, `${fmtDate(r.payload.old_due)} → ${fmtDate(r.payload.new_due)}`),
    r.response && h('div', {}, h('div', { class: 't-meta' }, 'Javob'), h('div', { class: 'text' }, r.response)),
    h('div', { class: 'between' },
      h('span', { class: 't-meta' }, r.status === 'kutilmoqda' ? `Yuborilgan: ${fmtDateTime(r.created_at)}` : `Javob: ${fmtDateTime(r.responded_at)}`),
      linked && h('span', { class: 't-meta', style: 'font-weight:700;color:var(--brand);display:flex;align-items:center;gap:2px' }, fixable ? 'Tuzatib qayta yuborish' : 'Ochish', icon('next', 16))));
}

export async function askDecision(task) {
  const ap = approverOf(S.me.id); if (!ap) return;
  const v = await sheetForm({ title: 'Qaror so\'rash', fields: [
    { id: 'title', label: 'Nima haqida', required: true, value: task ? task.title : '' },
    { id: 'body', label: 'Savol yoki variantlar', type: 'textarea', required: true }] });
  if (!v) return;
  const { data, error } = await sb.from('requests').insert({ kind: 'qaror', task_id: task ? task.id : null, requester_id: S.me.id, approver_id: ap.id, title: v.title, body: v.body }).select().single();
  if (error) { toast('Yuborib bo\'lmadi'); return; }
  ping(ap.id, 'qaror', 'Qaror so\'raldi', v.title, 'request', data.id);
  await loadRequests(); toast('So\'rov yuborildi'); bus.render();
}

export async function askReschedule(task) {
  const ap = S.profiles.find((p) => p.id === task.creator_id);
  if (S.requests.some((r) => r.kind === 'muddat' && r.task_id === task.id && r.status === 'kutilmoqda')) { toast('Bu topshiriq bo\'yicha so\'rov allaqachon yuborilgan'); return; }
  const v = await sheetForm({ title: 'Muddatni ko\'chirish', fields: [
    { id: 'new_due', label: 'Yangi muddat', type: 'date', required: true, min: today() },
    { id: 'reason', label: 'Sabab', type: 'textarea', required: true }] });
  if (!v) return;
  if (v.new_due === task.due_date) { toast('Yangi sana hozirgisi bilan bir xil'); return; }
  const { data, error } = await sb.from('requests').insert({ kind: 'muddat', task_id: task.id, requester_id: S.me.id, approver_id: ap.id, title: task.title, payload: { old_due: task.due_date, new_due: v.new_due, reason: v.reason } }).select().single();
  if (error) { toast('Yuborib bo\'lmadi'); return; }
  ping(ap.id, 'muddat', 'Muddatni ko\'chirish so\'raldi', task.title, 'request', data.id);
  await loadRequests(); toast('So\'rov yuborildi'); bus.render();
}

// ---------- Kunlik reja ----------
export function planItems(date) {
  return S.plan.filter((i) => i.owner_id === owner().id && i.plan_date === date)
    .sort((a, b) => (a.at_time || '99').localeCompare(b.at_time || '99') || a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}
/** Band kimniki: bo'sh bo'lsa reja egasiniki. */
export const forOf = (i) => i.for_id || i.owner_id;
const ownItems = (date) => planItems(date).filter((i) => forOf(i) === owner().id);
const P = { who: 'all', last: null };
const tag = (i) => (forOf(i) !== owner().id ? ` (${nameOf(forOf(i), true)})` : '');
const line = (i) => `${i.at_time ? i.at_time.slice(0, 5) + ' ' : ''}${i.title}${tag(i)}`;
async function editItem(i) {
  const v = await sheetForm({ title: 'Bandni tahrirlash', ok: 'Saqlash', fields: [
    { id: 'title', label: 'Matn', required: true, value: i.title }, { id: 'time', label: 'Vaqt', type: 'time', value: i.at_time ? i.at_time.slice(0, 5) : '' },
    { id: 'who', label: 'Kimniki', type: 'select', value: forOf(i), options: S.profiles.map((p) => [p.id, p.id === S.me.id ? 'Meniki' : nameOf(p.id, true)]) }] });
  if (!v) return;
  const { error } = await sb.from('plan_items').update({ title: v.title, at_time: v.time || null, for_id: v.who }).eq('id', i.id);
  if (error) { toast('Saqlab bo\'lmadi'); return; }
  await loadPlan(); bus.render();
}
async function togglePlan(i) {
  const { error } = await sb.from('plan_items').update({ done: !i.done, done_at: !i.done ? new Date().toISOString() : null }).eq('id', i.id);
  if (error) { toast('Saqlab bo\'lmadi'); return; }
  await loadPlan(); bus.render();
}
function PlanList(date, editable, canAdd = false) {
  const all = planItems(date), items = all.filter((i) => P.who === 'all' || forOf(i) === P.who);
  const approved = findDoc('reja', 'kunlik', date)?.status === 'tasdiqlandi';
  const chip = (val, label) => h('button', { type: 'button', class: 'fchip' + (P.who === val ? ' on' : ''), 'aria-pressed': String(P.who === val), onclick: () => { P.who = val; bus.render(); } }, label);
  const filter = all.some((i) => forOf(i) !== forOf(all[0])) || P.who !== 'all'
    ? h('div', { class: 'filters', style: 'margin-bottom:4px' }, chip('all', 'Hammasi'), S.profiles.map((p) => chip(p.id, p.id === S.me.id ? 'Meniki' : nameOf(p.id, true)))) : null;
  const rows = items.map((i) => {
    const canTick = editable || (canAdd && forOf(i) === S.me.id);
    const task = i.task_id ? S.tasks.find((t) => t.id === i.task_id) : null;
    return h('div', { class: 'planrow' },
      h('label', { class: 'check', style: 'flex:1;min-width:0' },
        h('input', { type: 'checkbox', checked: i.done, disabled: !canTick, onchange: () => togglePlan(i) }),
        h('span', { class: 'ptime' }, i.at_time ? i.at_time.slice(0, 5) : '—'),
        h('span', { style: 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding:8px 0' },
          h('span', { style: `overflow-wrap:anywhere;${i.done ? 'text-decoration:line-through;color:var(--muted)' : ''}` }, i.title),
          h('span', { class: 'pmeta' },
            h('span', { class: 'who ' + (forOf(i) === owner().id ? 'a' : 'b') }, nameOf(forOf(i), true)),
            i.added_by && i.added_by !== i.owner_id && h('span', { style: 'color:var(--blue);font-weight:600' }, `${nameOf(i.added_by, true)} qo'shdi`),
            i.added_after_approval && h('span', {}, 'tasdiqdan keyin'), task && h('span', {}, `№${task.seq}`)))),
      editable && h('button', { class: 'xbtn sm', type: 'button', 'aria-label': `«${i.title}» bandini tahrirlash`, onclick: () => editItem(i) }, icon('edit', 18)),
      (editable || (canAdd && i.added_by === S.me.id)) && h('button', { class: 'xbtn sm', type: 'button', 'aria-label': `«${i.title}» bandini o'chirish`, onclick: async () => {
        const { error } = await sb.from('plan_items').delete().eq('id', i.id);
        if (error) { toast('O\'chirib bo\'lmadi'); return; } await loadPlan(); bus.render();
      } }, '×'));
  });
  if (!editable && !canAdd) return h('div', {}, filter, rows.length ? rows : h('div', { class: 't-meta' }, 'Reja bandlari kiritilmagan.'));

  const time = h('input', { class: 'input', type: 'time', 'aria-label': 'Vaqt', style: 'width:112px;flex:none' });
  const title = h('input', { class: 'input', 'aria-label': 'Reja bandi', placeholder: 'Yangi band', maxlength: 200 });
  const myOpen = S.tasks.filter((t) => isOpen(t) && t.assignee_id === S.me.id);
  const link = h('select', { class: 'input', 'aria-label': 'Topshiriqqa bog\'lash' }, h('option', { value: '' }, 'Topshiriqqa bog\'lanmagan'), myOpen.map((t) => h('option', { value: t.id }, `№${t.seq} ${t.title.slice(0, 40)}`)));
  link.addEventListener('change', () => { if (link.value && !title.value.trim()) { const t = myOpen.find((x) => x.id === link.value); if (t) title.value = t.title; } });
  const whose = h('select', { class: 'input', 'aria-label': 'Band kimniki' }, S.profiles.map((p) => h('option', { value: p.id }, `Kimniki: ${p.id === S.me.id ? 'meniki' : nameOf(p.id, true)}`)));
  whose.value = P.who !== 'all' ? P.who : (P.last || S.me.id);
  whose.addEventListener('change', () => { P.last = whose.value; });
  const add = async (e) => {
    e.preventDefault();
    const v = title.value.trim(); if (!v) { title.focus(); return; }
    const { error } = await sb.from('plan_items').insert({ owner_id: owner().id, added_by: S.me.id, for_id: whose.value, plan_date: date, at_time: time.value || null, title: v, task_id: editable ? (link.value || null) : null, added_after_approval: approved, sort: all.length });
    if (error) { toast('Qo\'shib bo\'lmadi: ' + error.message); return; }
    if (!editable) ping(owner().id, 'reja', 'Rejangizga band qo\'shildi', v, 'plan', null);
    await loadPlan(); bus.render();
  };
  return h('div', {}, filter, rows.length ? rows : h('div', { class: 't-meta', style: 'padding:6px 0' }, all.length ? 'Bu filtrda band yo\'q.' : 'Hali band yo\'q. Birinchisini qo\'shing.'),
    h('form', { onsubmit: add, style: 'display:flex;flex-direction:column;gap:8px;margin-top:10px' },
      h('div', { class: 'row' }, time, title), whose, editable && myOpen.length ? link : null,
      h('button', { class: 'btn ghost', type: 'submit' }, '+ Band qo\'shish')));
}

/** Bosh ekrandagi reja qismi. */
export function HomePlan() {
  const d = today(), items = planItems(d), done = items.filter((i) => i.done).length;
  const rep = findDoc('reja', 'kunlik', d);
  if (!iAmOwner()) {
    return h('section', { class: 'card' },
      h('div', { class: 'between' }, h('b', {}, 'Bugungi kun tartibi'), h('span', { class: 't-meta' }, items.length ? `${items.length} tadan ${done} tasi bajarildi` : 'Kiritilmagan')),
      PlanList(d, false, true),
      h('a', { href: '#/hisobot', style: 'font-size:13px;font-weight:600' }, 'Reja va hisobotni ko\'rish'));
  }
  return h('section', { class: 'card' },
    h('div', { class: 'between' }, h('b', {}, 'Bugungi reja'), docChip(rep)),
    PlanList(d, true),
    h('a', { href: '#/hisobot', style: 'font-size:13px;font-weight:600' }, 'Reja va hisobot bo\'limi'));
}

// ---------- Hisobot matnini tuzish ----------
const numbered = (arr) => (arr.length ? arr.map((x, i) => `${i + 1}. ${x}`).join('\n') : '—');
function genDaily(date) {
  const o = owner().id;
  const doneTasks = S.tasks.filter((t) => t.assignee_id === o && dayOf(t.submitted_at) === date).map((t) => t.title);
  const items = ownItems(date);
  const donePlan = items.filter((i) => i.done && !doneTasks.includes(i.title)).map((i) => i.title);
  const inWork = S.tasks.filter((t) => t.assignee_id === o && ['jarayonda', 'kutilmoqda'].includes(t.status)).map((t) => `${t.title} (muddat ${fmtDate(t.due_date)})`);
  const undone = items.filter((i) => !i.done).map((i) => `${i.title} (sabab: )`);
  const asks = S.requests.filter((r) => r.requester_id === o && r.status === 'kutilmoqda' && ['qaror', 'muddat'].includes(r.kind))
    .map((r) => (r.kind === 'muddat' ? `Muddatni ko'chirish: ${r.title} (${fmtDate(r.payload.old_due)} → ${fmtDate(r.payload.new_due)})` : `Qaror: ${r.title}`));
  const tomorrow = ownItems(addDays(date, 1)).map((i) => `${i.at_time ? i.at_time.slice(0, 5) + ' ' : ''}${i.title}`);
  return `Bajarildi:\n${numbered([...doneTasks, ...donePlan])}\n\nJarayonda:\n${numbered(inWork)}\n\nBajarilmadi:\n${numbered(undone)}\n\nSizning qaroringiz kerak:\n${numbered(asks)}\n\nErtangi muhim ishlar:\n${numbered(tomorrow)}`;
}

export function indicators(start, end) {
  const o = owner().id, last = end > today() ? today() : end;
  const done = S.tasks.filter((t) => t.assignee_id === o && t.status === 'bajarildi' && inRange(dayOf(t.submitted_at || t.closed_at), start, end));
  const good = done.filter((t) => onTime(t)).length;
  const moved = S.requests.filter((r) => r.kind === 'muddat' && r.status === 'tasdiqlandi' && r.requester_id === o && inRange(dayOf(r.responded_at), start, end)).length;
  const returned = S.tasks.filter((t) => t.assignee_id === o && t.returned_count > 0 && inRange(dayOf(t.updated_at), start, end)).length;
  const items = S.plan.filter((i) => i.owner_id === o && forOf(i) === o && inRange(i.plan_date, start, last));
  // Hisobot intizomi: yakshanbadan tashqari kunlar, birinchi hujjat kunidan boshlab
  const docs = S.reports.filter((r) => r.owner_id === o && r.period === 'kunlik');
  const first = docs.length ? docs.reduce((m, r) => (r.period_start < m ? r.period_start : m), docs[0].period_start) : null;
  let days = 0, ok = 0;
  if (first) for (let d = start < first ? first : start; d <= last; d = addDays(d, 1)) {
    if (new Date(d + 'T12:00:00').getDay() === 0) continue;
    days++;
    const rj = docs.find((r) => r.doc_type === 'reja' && r.period_start === d), hs = docs.find((r) => r.doc_type === 'hisobot' && r.period_start === d);
    if (rj && rj.on_time && hs && hs.on_time) ok++;
  }
  const levels = [1, 2, 3, 4, 5].map((n) => { const x = done.filter((t) => t.level === n); return { n, total: x.length, good: x.filter((t) => onTime(t)).length }; }).filter((x) => x.total);
  return { done: done.length, good, late: done.length - good, pct: done.length ? Math.round((good / done.length) * 100) : null,
    moved, returned, planTotal: items.length, planDone: items.filter((i) => i.done).length,
    days, okDays: ok, discipline: days ? Math.round((ok / days) * 100) : null, levels,
    open: S.tasks.filter((t) => t.assignee_id === o && isOpen(t)).length,
    overdue: S.tasks.filter((t) => t.assignee_id === o && isOpen(t) && t.due_date < today()).length };
}
const pc = (v) => (v == null ? '—' : v + '%');
function genPeriod(kind, start, end) {
  const k = indicators(start, end), o = owner().id;
  const closed = S.tasks.filter((t) => t.assignee_id === o && t.status === 'bajarildi' && inRange(dayOf(t.submitted_at || t.closed_at), start, end)).map((t) => `${t.title}${onTime(t) ? '' : ' (kechikib)'}`);
  const open = S.tasks.filter((t) => t.assignee_id === o && isOpen(t)).map((t) => `${t.title} (muddat ${fmtDate(t.due_date)})`);
  const head = kind === 'haftalik' ? `Hafta: ${fmtDate(start)} – ${fmtDate(end)}` : `Oy: ${monthName(start)}`;
  return `${head}\n\nKo'rsatkichlar:\n- Bajarilgan topshiriqlar: ${k.done} (vaqtida ${k.good}, kechikib ${k.late})\n- Vaqtida bajarish: ${pc(k.pct)}\n- Reja bandlari: ${k.planTotal} tadan ${k.planDone} tasi bajarildi\n- Hisobot intizomi: ${pc(k.discipline)}\n- Muddati ko'chirilgan: ${k.moved}\n- Qaytarilgan: ${k.returned}\n- Ochiq qolgan: ${k.open} (shundan kechikkan ${k.overdue})\n\nBajarilgan ishlar:\n${numbered(closed)}\n\nKeyingi davrga o'tadigan ishlar:\n${numbered(open)}\n\n${kind === 'haftalik' ? 'Keyingi hafta rejasi' : 'Keyingi oy rejasi'}:\n1. `;
}

// ---------- Hisobot bo'limi ----------

/** Bitta hisobot kartasi: egasi tuzadi va yuboradi, tasdiqlovchi ko'radi. */
/** Uzun matn: yig'ilgan holda 5 qator, bosilganda to'liq ochiladi. */
const OPEN = new Set();
function clip(text, key) {
  const long = (text || '').split('\n').length > 5 || (text || '').length > 280;
  if (!long) return h('div', { class: 'text' }, text || '');
  const open = OPEN.has(key);
  const flip = () => { open ? OPEN.delete(key) : OPEN.add(key); bus.render(); };
  return h('div', {},
    h('div', { class: 'text' + (open ? '' : ' clip'), onclick: flip }, text),
    h('button', { class: 'more', type: 'button', 'aria-expanded': String(open), onclick: flip }, open ? 'Yig\'ish' : 'To\'liq ko\'rsatish'));
}

function ReportCard({ period, start, end, title, generate }) {
  const rep = findDoc('hisobot', period, start);
  const mine = iAmOwner();
  const head = h('div', { class: 'between' }, h('b', {}, title), docChip(rep));
  const sent = rep && ['yuborildi', 'tasdiqlandi'].includes(rep.status);
  if (!mine) {
    const req = rep && pendingForMe().find((r) => r.report_id === rep.id);
    return h('section', { class: 'card' }, head,
      rep && rep.status !== 'qoralama' ? clip(rep.body, rep.id) : h('div', { class: 't-meta' }, 'Hali yuborilmagan.'),
      rep && rep.sent_at && h('div', { class: 't-meta' }, `Yuborilgan: ${fmtDateTime(rep.sent_at)}${rep.on_time === false ? ' · kechikib' : ''}`),
      rep && rep.approver_comment && h('div', {}, h('div', { class: 't-meta' }, 'Sizning izohingiz'), h('div', { class: 'text' }, rep.approver_comment)),
      req && h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => respond(req, true, null) }, 'Tasdiqlash'),
        h('button', { class: 'btn ghost', onclick: async () => { const v = await ask({ title: 'Izoh yozing', label: 'Nimani o\'zgartirish kerak', ok: 'Yuborish' }); if (v != null) respond(req, false, v); } }, 'Izoh yozish')),
      rep && rep.status !== 'qoralama' && h('a', { href: `#/hisobot/${rep.id}`, class: 't-meta', style: 'font-weight:700;color:var(--brand);min-height:44px;display:flex;align-items:center;gap:2px' }, 'Alohida sahifada ochish', icon('next', 16)));
  }
  if (sent) {
    const editReq = S.requests.find((r) => r.kind === 'hisobot_tuzatish' && r.report_id === rep.id && r.status === 'kutilmoqda');
    return h('section', { class: 'card' }, head,
      clip(rep.body, rep.id),
      h('div', { class: 't-meta' }, `Yuborilgan: ${fmtDateTime(rep.sent_at)}${rep.on_time === false ? ' · kechikib' : ''}`),
      rep.approver_comment && h('div', {}, h('div', { class: 't-meta' }, 'Izoh'), h('div', { class: 'text' }, rep.approver_comment)),
      editReq ? h('div', { class: 't-meta c-amber', style: 'font-weight:600' }, 'Tuzatish so\'rovi yuborilgan, javob kutilmoqda.')
        : h('button', { class: 'btn ghost', onclick: () => askReportEdit(rep) }, 'Tuzatish so\'rash'));
  }
  const ta = h('textarea', { class: 'input', 'aria-label': title + ' matni', style: 'min-height:260px', value: rep && rep.body ? rep.body : generate() });
  return h('section', { class: 'card' }, head,
    rep && rep.status === 'qaytarildi' && rep.approver_comment && h('div', { class: 'banner', style: 'background:var(--red-tint);color:var(--red)' }, 'Qaytarildi: ' + rep.approver_comment),
    h('div', { class: 't-meta' }, 'Matnni dastur tuzdi. Tekshiring, kerak bo\'lsa tuzating va yuboring.'),
    ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: async () => { if (ta.value.trim() === generate().trim() || await confirmBox({ title: 'Qayta tuzilsinmi?', text: 'Qo\'lda yozgan o\'zgarishlaringiz o\'chadi.', ok: 'Qayta tuzish' })) ta.value = generate(); } }, 'Qayta tuzish'),
      h('button', { class: 'btn', type: 'button', onclick: () => { const body = ta.value.trim(); if (!body) { toast('Matn bo\'sh'); return; } sendDoc({ docType: 'hisobot', period, start, end, body }); } }, 'Yuborish')));
}

async function askReportEdit(rep) {
  const ap = approverOf(S.me.id); if (!ap) return;
  const v = await sheetForm({ title: 'Hisobotni tuzatish', ok: 'Tasdiqqa yuborish', fields: [
    { id: 'new_body', label: 'Yangi matn', type: 'textarea', required: true, value: rep.body },
    { id: 'reason', label: 'Nega o\'zgartirilmoqda', required: true }] });
  if (!v) return;
  if (v.new_body === (rep.body || '').trim()) { toast('Matn o\'zgarmagan'); return; }
  const { data, error } = await sb.from('requests').insert({ kind: 'hisobot_tuzatish', report_id: rep.id, requester_id: S.me.id, approver_id: ap.id, title: `${docName(rep)} · ${docPeriod(rep)}`, payload: { new_body: v.new_body, reason: v.reason } }).select().single();
  if (error) { toast('Yuborib bo\'lmadi'); return; }
  ping(ap.id, 'tuzatish', 'Hisobotni tuzatish so\'raldi', docPeriod(rep), 'request', data.id);
  await loadRequests(); toast('Tasdiqqa yuborildi'); bus.render();
}

function DailyTab() {
  const d = R.date || today(), mine = iAmOwner();
  const rep = findDoc('reja', 'kunlik', d);
  const yUndone = planItems(addDays(d, -1)).filter((i) => !i.done && !planItems(d).some((x) => x.carried_from === i.id));
  const req = rep && pendingForMe().find((r) => r.report_id === rep.id);
  const chip = (val, label) => h('button', { class: 'fchip' + (d === val ? ' on' : ''), type: 'button', 'aria-pressed': String(d === val), onclick: () => { R.date = val; bus.render(); } }, label);
  const canSend = mine && planItems(d).length > 0 && (!rep || rep.status === 'qoralama' || rep.status === 'qaytarildi');
  const archive = S.reports.filter((r) => r.owner_id === owner().id && r.period === 'kunlik' && r.status !== 'qoralama' && !(r.doc_type === 'hisobot' && r.period_start === today()))
    .sort((x, y) => y.period_start.localeCompare(x.period_start) || x.doc_type.localeCompare(y.doc_type)).slice(0, 30);
  const stName = (r) => r.status === 'tasdiqlandi' ? 'Tasdiqlandi' : r.status === 'qaytarildi' ? 'Qaytarildi' : 'Tasdiq kutilmoqda';

  return [
    h('div', { class: 'filters' }, chip(addDays(today(), -1), 'Kecha'), chip(today(), 'Bugun'), chip(addDays(today(), 1), 'Ertaga')),
    h('section', { class: 'card' },
      h('div', { class: 'between' }, h('b', {}, `Reja · ${fmtDay(d)}`), docChip(rep)),
      rep && rep.status !== 'qoralama' && h('a', { href: `#/hisobot/${rep.id}`, class: 't-meta', style: 'font-weight:700;color:var(--brand);min-height:44px;display:flex;align-items:center;gap:2px' }, 'Yuborilgan rejani ochish', icon('next', 16)),
      rep && rep.status === 'qaytarildi' && rep.approver_comment && h('div', { class: 'banner', style: 'background:var(--red-tint);color:var(--red)' }, 'Qaytarildi: ' + rep.approver_comment),
      PlanList(d, mine && d >= today(), !mine && d >= today()),
      mine && d >= today() && yUndone.length > 0 && h('button', { class: 'btn ghost', onclick: async () => {
        const rows = yUndone.map((i, n) => ({ owner_id: S.me.id, plan_date: d, at_time: i.at_time, title: i.title, task_id: i.task_id, carried_from: i.id, for_id: i.for_id || null, added_by: S.me.id, sort: 100 + n, added_after_approval: rep?.status === 'tasdiqlandi' }));
        const { error } = await sb.from('plan_items').insert(rows);
        if (error) { toast('Ko\'chirib bo\'lmadi'); return; } await loadPlan(); toast(`${rows.length} ta band ko'chirildi`); bus.render();
      } }, `Oldingi kundan bajarilmagan ${yUndone.length} ta bandni ko'chirish`),
      canSend && h('button', { class: 'btn', onclick: () => sendDoc({ docType: 'reja', period: 'kunlik', start: d, end: d, body: planItems(d).map(line).join('\n') }) }, rep?.status === 'qaytarildi' ? 'Rejani qayta yuborish' : 'Rejani tasdiqqa yuborish'),
      req && h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => respond(req, true, null) }, 'Rejani tasdiqlash'),
        h('button', { class: 'btn ghost', onclick: async () => { const v = await ask({ title: 'Izoh yozing', label: 'Nimani o\'zgartirish kerak', ok: 'Yuborish' }); if (v != null) respond(req, false, v); } }, 'Izoh yozish'))),
    d <= today() ? ReportCard({ period: 'kunlik', start: d, end: d, title: `Kechki hisobot · ${fmtDay(d)}`, generate: () => genDaily(d) }) : null,
    archive.length ? [h('div', { class: 'section' }, h('h2', {}, 'Rejalar va hisobotlar tarixi')),
      h('div', { class: 'list' }, archive.map((r) => h('a', { href: `#/hisobot/${r.id}` }, h('span', {}, h('b', {}, `${r.doc_type === 'reja' ? 'Reja' : 'Hisobot'} · ${fmtDay(r.period_start)}`), h('small', {}, stName(r), r.on_time === false ? ' · kechikib' : '')), icon('next', 18, '#56645F'))))] : null,
  ];
}

function PeriodTab(kind) {
  const t = today();
  const start = kind === 'haftalik' ? mondayOf(t) : monthStart(t);
  const end = kind === 'haftalik' ? addDays(start, 6) : monthEnd(t);
  const title = kind === 'haftalik' ? `Haftalik hisobot · ${fmtDate(start)} – ${fmtDate(end)}` : `Oylik hisobot · ${monthName(start)}`;
  const archive = S.reports.filter((r) => r.owner_id === owner().id && r.doc_type === 'hisobot' && r.period === kind && r.status !== 'qoralama' && r.period_start !== start).slice(0, 12);
  return [
    ReportCard({ period: kind, start, end, title, generate: () => genPeriod(kind, start, end) }),
    archive.length ? [h('div', { class: 'section' }, h('h2', {}, 'Oldingi hisobotlar')),
      h('div', { class: 'list' }, archive.map((r) => h('a', { href: `#/hisobot/${r.id}` }, h('span', {}, h('b', {}, docPeriod(r)), h('small', {}, r.status === 'tasdiqlandi' ? 'Tasdiqlandi' : 'Tasdiq kutilmoqda')), icon('next', 18, '#56645F'))))] : null,
  ];
}

function StatsTab() {
  const t = today();
  const [start, end] = R.range === 'hafta' ? [mondayOf(t), addDays(mondayOf(t), 6)] : R.range === 'oy' ? [monthStart(t), monthEnd(t)] : ['2000-01-01', '2999-12-31'];
  const k = indicators(start, end), goal = S.settings.maqsad || { vaqtida_foiz: 90, intizom_foiz: 100 };
  const chip = (val, label) => h('button', { class: 'fchip' + (R.range === val ? ' on' : ''), type: 'button', 'aria-pressed': String(R.range === val), onclick: () => { R.range = val; bus.render(); } }, label);
  const row = (label, val, note) => h('div', { class: 'between', style: 'padding:8px 0;border-top:1px solid var(--soft)' }, h('span', {}, label, note && h('span', { class: 't-meta' }, ' · ' + note)), h('b', {}, val));
  return [
    h('div', { class: 'filters' }, chip('hafta', 'Hafta'), chip('oy', 'Oy'), chip('hammasi', 'Hammasi')),
    h('div', { class: 't-meta', style: 'padding:0 4px' }, `${nameOf(owner().id)} ko'rsatkichlari`),
    h('section', { class: 'card' },
      h('div', { class: 'between' }, h('b', {}, 'Vaqtida bajarish'), h('b', { class: 'c-brand', style: 'font-size:22px' }, pc(k.pct))),
      h('div', { class: 'bar two', role: 'img', 'aria-label': `${k.good} tasi vaqtida, ${k.late} tasi kechikib` }, k.done ? [h('div', { style: `flex:${k.good}` }), h('div', { class: 'late', style: `flex:${k.late}` })] : null),
      h('div', { class: 'between t-meta' }, h('span', {}, `Vaqtida: ${k.good}`), h('span', {}, `Kechikib: ${k.late}`)),
      h('div', { class: 't-meta' }, `Maqsad: ${goal.vaqtida_foiz}% va undan yuqori`)),
    h('section', { class: 'card', style: 'gap:0' },
      h('b', { style: 'padding-bottom:8px' }, 'Ko\'rsatkichlar'),
      row('Bajarilgan topshiriqlar', k.done),
      row('Ochiq topshiriqlar', k.open, k.overdue ? `kechikkan ${k.overdue}` : null),
      row('Reja bandlari', `${k.planDone} / ${k.planTotal}`),
      row('Hisobot intizomi', pc(k.discipline), k.days ? `${k.days} kundan ${k.okDays} kuni` : `maqsad ${goal.intizom_foiz}%`),
      row('Muddati ko\'chirilgan', k.moved),
      row('Qaytarilgan topshiriqlar', k.returned)),
    k.levels.length ? h('section', { class: 'card', style: 'gap:0' },
      h('b', { style: 'padding-bottom:8px' }, 'Vakolat darajasi bo\'yicha'),
      k.levels.map((l) => row(`${l.n}-daraja`, `${l.total} ta`, `vaqtida ${l.good}`))) : null,
  ];
}

export function ReportsView() {
  const tab = (val, label) => h('button', { type: 'button', class: R.tab === val ? 'on' : '', 'aria-pressed': String(R.tab === val), onclick: () => { R.tab = val; bus.render(); } }, label);
  return h('main', { class: 'view' },
    Head(iAmOwner() ? 'Reja va hisobotlar' : `${nameOf(owner().id, true)}: reja va hisobotlar`, 'Hisobot'),
    h('div', { class: 'seg' }, tab('kunlik', 'Kunlik'), tab('haftalik', 'Haftalik'), tab('oylik', 'Oylik'), tab('stat', 'Statistika')),
    R.tab === 'kunlik' ? DailyTab() : R.tab === 'stat' ? StatsTab() : PeriodTab(R.tab));
}

export function ReportDetail(id) {
  const r = S.reports.find((x) => x.id === id);
  if (!r) return h('main', { class: 'view' }, BackHead('Topilmadi', '#/hisobot'), Empty('Hisobot topilmadi', ''));
  return h('main', { class: 'view' },
    BackHead(docName(r), '#/hisobot'),
    h('section', { class: 'card' },
      h('div', { class: 'between' }, h('b', {}, docPeriod(r)), docChip(r)),
      h('div', { class: 'text' }, r.body || ''),
      r.doc_type === 'reja' && r.period === 'kunlik' && planItems(r.period_start).length > 0 && h('div', {},
        h('div', { class: 't-meta', style: 'margin-bottom:4px' }, 'Hozirgi holati'),
        planItems(r.period_start).map((i) => h('div', { class: 'text', style: i.done ? 'color:var(--brand-dark)' : '' }, `${i.done ? '✓' : '○'} ${line(i)}${i.added_after_approval ? ' (tasdiqdan keyin)' : ''}`))),
      h('div', { class: 't-meta' }, `Yuborilgan: ${fmtDateTime(r.sent_at)}${r.on_time === false ? ' · kechikib' : ''}`),
      r.approved_at && h('div', { class: 't-meta' }, `Tasdiqlagan: ${nameOf(r.approver_id, true)} · ${fmtDateTime(r.approved_at)}`),
      r.approver_comment && h('div', {}, h('div', { class: 't-meta' }, 'Izoh'), h('div', { class: 'text' }, r.approver_comment)),
      r.owner_id === S.me.id && r.status === 'qaytarildi' && r.period === 'kunlik' && h('button', { class: 'btn', onclick: () => { R.tab = 'kunlik'; R.date = r.period_start; go('#/hisobot'); } }, 'Tuzatib qayta yuborish')),
    (r.changes || []).length ? [h('div', { class: 'section' }, h('h2', {}, 'O\'zgarishlar')),
      h('section', { class: 'card' }, h('div', { class: 'log' }, [...r.changes].reverse().map((c) => h('div', { class: 'item' },
        h('span', { class: 'who' }, nameOf(c.by, true)), ' ', h('span', { class: 'when' }, `${fmtDateTime(c.at)} · tasdiqladi ${nameOf(c.approved_by, true)}`),
        h('div', { class: 't-meta', style: 'margin-top:6px' }, 'Sabab'), h('div', { class: 'text' }, c.reason),
        h('div', { class: 't-meta', style: 'margin-top:6px' }, 'Oldingi matn'), h('div', { class: 'text' }, c.old || '')))))] : null);
}
