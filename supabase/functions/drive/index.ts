// Devon: Google Drive bilan ishlash. Fayllar admin (Zufarbek) Drive'idagi «Devon fayllari» papkasiga tushadi.
// Maxfiy kalitlar: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Supabase → Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CSECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const APP = "https://zufarbekshonazarov1025-lgtm.github.io/devon/";
const ORIGINS = ["https://zufarbekshonazarov1025-lgtm.github.io", "https://localhost", "capacitor://localhost"];
const REDIRECT = `${URL_}/functions/v1/drive`;
const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const MAX_BYTES = 200 * 1024 * 1024;

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

async function whoAmI(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await asUser.auth.getUser(auth.slice(7));
  if (!data?.user) return null;
  const { data: prof } = await admin.from("profiles").select("id,is_admin").eq("id", data.user.id).maybeSingle();
  if (!prof) return null;
  return { id: prof.id as string, isAdmin: !!prof.is_admin, asUser };
}

async function accessToken() {
  const { data: link } = await admin.from("drive_link").select("refresh_token,folder_id").eq("id", 1).maybeSingle();
  if (!link?.refresh_token || !link.folder_id) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSECRET, refresh_token: link.refresh_token, grant_type: "refresh_token" }),
  });
  if (!r.ok) {
    // Ruxsat bekor qilingan bo'lsa, holatni «ulanmagan» qilamiz
    if (r.status === 400 || r.status === 401) await admin.from("app_settings").upsert({ key: "drive", value: { connected: false, error: "Ruxsat bekor qilingan, qayta ulang" } });
    return null;
  }
  const j = await r.json();
  return { token: j.access_token as string, folder: link.folder_id as string };
}
const g = (token: string, url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });

// ---------- Zaxira nusxa: kutubxonasiz .xlsx ----------
const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8: Uint8Array) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []; let off = 0;
  for (const [name, text] of files) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30)); head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, nm.length, true);
    const cen = new DataView(new ArrayBuffer(46)); cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nm.length, true); cen.setUint32(42, off, true);
    parts.push(new Uint8Array(head.buffer), nm, data); central.push(new Uint8Array(cen.buffer), nm); off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
const esc = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 32000);
const col = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
type Cell = string | number | null | undefined;
function sheetXml(rows: Cell[][]) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => typeof v === "number"
    ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`
    : `<c r="${col(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${rows[0].map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="22" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
}
function xlsx(sheets: [string, Cell[][]][]): Uint8Array {
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows)] as [string, string]),
  ]);
}
// Toshkent vaqti (UTC+5) bo'yicha sana va vaqt
const tk = (ts: string | null | undefined) => (ts ? new Date(Date.parse(ts) + 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "");
const today5 = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

async function runBackup() {
  const acc = await accessToken();
  if (!acc) return { error: "Drive ulanmagan" };
  const { data: link } = await admin.from("drive_link").select("backup_folder_id").eq("id", 1).maybeSingle();
  let folder = link?.backup_folder_id as string | null;
  if (folder) { const chk = await g(acc.token, `https://www.googleapis.com/drive/v3/files/${folder}?fields=id,trashed`); if (!chk.ok || (await chk.json()).trashed) folder = null; }
  if (!folder) {
    const f = await g(acc.token, "https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Zaxira nusxalar", mimeType: "application/vnd.google-apps.folder", parents: [acc.folder] }) });
    if (!f.ok) return { error: "Zaxira papkasini yaratib bo'lmadi" };
    folder = (await f.json()).id;
    await admin.from("drive_link").update({ backup_folder_id: folder }).eq("id", 1);
  }
  const q = async (t: string, order: string) => (await admin.from(t).select("*").order(order).limit(20000)).data ?? [];
  const [profs, contacts, tasks, plan, reps, reqs, events, rems, recs, comms, atts, kudos, sets] = await Promise.all([
    q("profiles", "created_at"), q("contacts", "name"), q("tasks", "seq"), q("plan_items", "plan_date"), q("reports", "period_start"), q("requests", "created_at"),
    q("events", "starts_at"), q("reminders", "created_at"), q("recurrences", "created_at"), q("task_comments", "created_at"), q("attachments", "created_at"), q("kudos", "created_at"), q("app_settings", "key")]);
  const nm = (id: string | null) => (profs.find((p) => p.id === id)?.full_name as string) ?? "";
  const cn = (id: string | null) => (contacts.find((c) => c.id === id)?.name as string) ?? "";
  const seq = (id: string | null) => { const t = tasks.find((x) => x.id === id); return t ? Number(t.seq) : ""; };
  const yn = (b: unknown) => (b ? "Ha" : "");
  const sheets: [string, Cell[][]][] = [
    ["Topshiriqlar", [["№", "Topshiriq", "Izoh", "Nima uchun", "Topshiruvchi", "Mas'ul", "Holati", "Muddat", "Asl muddat", "Ko'chirilgan", "Yaratilgan", "Qabul qilingan", "Bajarilgan", "Yopilgan", "Natija", "Kimdan kutilmoqda", "Daraja", "Qaytarilgan", "Shaxsiy", "Savatda"],
      ...tasks.map((t) => [Number(t.seq), t.title, t.description, t.purpose, nm(t.creator_id), nm(t.assignee_id), t.status, t.due_date, t.original_due_date, Number(t.reschedule_count ?? 0), tk(t.created_at), tk(t.accepted_at), tk(t.submitted_at), tk(t.closed_at), t.result, cn(t.waiting_on), t.level ?? "", Number(t.returned_count ?? 0), yn(t.is_private), tk(t.deleted_at)] as Cell[])]],
    ["Reja", [["Sana", "Vaqt", "Band", "Kimniki", "Bajarildi", "Bajarilgan vaqt", "Tasdiqdan keyin", "Kim qo'shgan", "Topshiriq №", "Shaxsiy"],
      ...plan.map((i) => [i.plan_date, String(i.at_time ?? "").slice(0, 5), i.title, nm(i.for_id ?? i.owner_id), yn(i.done), tk(i.done_at), yn(i.added_after_approval), nm(i.added_by), seq(i.task_id), yn(i.is_private)] as Cell[])]],
    ["Hisobotlar", [["Turi", "Davr", "Boshlanishi", "Tugashi", "Egasi", "Holati", "Yuborilgan", "O'z vaqtida", "Tasdiqlagan", "Tasdiqlangan", "Izoh", "Matn", "O'zgarishlar"],
      ...reps.map((r) => [r.doc_type, r.period, r.period_start, r.period_end, nm(r.owner_id), r.status, tk(r.sent_at), r.on_time === false ? "Yo'q" : r.on_time ? "Ha" : "", nm(r.approver_id), tk(r.approved_at), r.approver_comment, r.body, (r.changes ?? []).length ? JSON.stringify(r.changes) : ""] as Cell[])]],
    ["So'rovlar", [["Turi", "Sarlavha", "Matn", "Kim so'radi", "Kimdan", "Holati", "Javob", "Yuborilgan", "Javob berilgan", "Topshiriq №", "Tafsilot"],
      ...reqs.map((r) => [r.kind, r.title, r.body, nm(r.requester_id), nm(r.approver_id), r.status, r.response, tk(r.created_at), tk(r.responded_at), seq(r.task_id), r.payload && Object.keys(r.payload).length ? JSON.stringify(r.payload) : ""] as Cell[])]],
    ["Uchrashuvlar", [["Nomi", "Kimniki", "Boshlanishi", "Tugashi", "Kun bo'yi", "Joy", "Kim bilan", "Takror", "Izoh", "Kim qo'shgan", "Shaxsiy"],
      ...events.map((e) => [e.title, nm(e.owner_id), tk(e.starts_at), tk(e.ends_at), yn(e.all_day), e.location, e.with_whom, e.repeat, e.notes, nm(e.created_by), yn(e.is_private)] as Cell[])]],
    ["Eslatmalar", [["Nimani", "Kimniki", "Takror", "Sana va vaqt", "Vaqt", "Hafta kuni", "Oy kuni", "Ikkalamizga", "Yoqilgan", "Shaxsiy"],
      ...rems.map((r) => [r.title, nm(r.owner_id), r.repeat, tk(r.remind_at), String(r.at_time ?? "").slice(0, 5), r.weekday ?? "", r.monthday ?? "", yn(r.for_both), yn(r.active), yn(r.is_private)] as Cell[])]],
    ["Takroriy", [["Nomi", "Kim yaratgan", "Kimga", "Takror", "Hafta kuni", "Oy kuni", "Muddat (kun)", "Keyingisi", "Yoqilgan", "Shaxsiy"],
      ...recs.map((r) => [r.title, nm(r.creator_id), nm(r.assignee_id), r.freq, r.weekday ?? "", r.monthday ?? "", Number(r.due_offset_days ?? 0), r.next_run, yn(r.active), yn(r.is_private)] as Cell[])]],
    ["Izohlar", [["Topshiriq №", "Kim", "Vaqt", "Izoh"], ...comms.map((c) => [seq(c.task_id), nm(c.author_id), tk(c.created_at), c.body] as Cell[])]],
    ["Fayllar", [["Topshiriq №", "Fayl", "Havola", "Hajmi (bayt)", "Kim yuklagan", "Vaqt"], ...atts.map((a) => [seq(a.task_id), a.name, a.url, Number(a.size_bytes ?? 0), nm(a.uploader_id), tk(a.created_at)] as Cell[])]],
    ["Rahmatlar", [["Kimdan", "Kimga", "Turi", "Topshiriq №", "Vaqt"], ...kudos.map((k) => [nm(k.from_id), nm(k.to_id), k.kind, seq(k.task_id), tk(k.created_at)] as Cell[])]],
    ["Sozlamalar", [["Kalit", "Qiymat"], ...sets.filter((s) => s.key !== "drive" && s.key !== "zaxira").map((s) => [s.key, JSON.stringify(s.value)] as Cell[])]],
  ];
  const bytes = xlsx(sheets), name = `Devon_zaxira_${today5()}.xlsx`, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  // Shu kungi fayl bo'lsa, ustidan yozamiz (kuniga bitta fayl)
  const found = await g(acc.token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and name='${name}' and trashed=false`)}&fields=files(id)`);
  const existing = found.ok ? ((await found.json()).files ?? [])[0]?.id : null;
  let up: Response;
  if (existing) {
    up = await g(acc.token, `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&fields=id,webViewLink`, { method: "PATCH", headers: { "Content-Type": mime }, body: bytes });
  } else {
    const b = "devon" + crypto.randomUUID(), enc = new TextEncoder();
    const pre = enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`), post = enc.encode(`\r\n--${b}--`);
    const body = new Uint8Array(pre.length + bytes.length + post.length); body.set(pre); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
    up = await g(acc.token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
  }
  if (!up.ok) return { error: "Zaxira faylini yuklab bo'lmadi" };
  const file = await up.json();
  // Eskilarini Drive savatiga o'tkazamiz (sozlamadagi kun, odatda 90)
  const keep = Number(sets.find((s) => s.key === "zaxira_kun")?.value ?? 90) || 90;
  const cutoff = new Date(Date.now() - keep * 86400000).toISOString();
  const old = await g(acc.token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and name contains 'Devon_zaxira_' and createdTime < '${cutoff}' and trashed=false`)}&fields=files(id)&pageSize=200`);
  let removed = 0;
  if (old.ok) for (const f of (await old.json()).files ?? []) { const r = await g(acc.token, `https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); if (r.ok) removed++; }
  const info = { at: new Date().toISOString(), file: name, url: file.webViewLink ?? null, folder_url: `https://drive.google.com/drive/folders/${folder}`, tasks: tasks.length, removed };
  await admin.from("app_settings").upsert({ key: "zaxira", value: info });
  return { ok: true, ...info };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const url = new URL(req.url);

  // --- Google'dan qaytish (brauzer yo'naltirishi) ---
  if (req.method === "GET") {
    const back = (msg: string) => Response.redirect(`${APP}?drive=${encodeURIComponent(msg)}#/admin`, 302);
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state) return back("bekor");
    const { data: link } = await admin.from("drive_link").select("state,state_user,state_at").eq("id", 1).maybeSingle();
    if (!link?.state || link.state !== state || !link.state_at || Date.now() - Date.parse(link.state_at) > 10 * 60 * 1000) return back("muddat");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: CID, client_secret: CSECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    });
    if (!r.ok) return back("xato");
    const tok = await r.json();
    if (!tok.refresh_token) return back("kalit");
    const me = await (await g(tok.access_token, "https://www.googleapis.com/oauth2/v2/userinfo")).json();
    const f = await g(tok.access_token, "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Devon fayllari", mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!f.ok) return back("papka");
    const folder = await f.json();
    await admin.from("drive_link").update({ refresh_token: tok.refresh_token, folder_id: folder.id, email: me.email ?? null, state: null, state_user: null, state_at: null, connected_by: link.state_user, connected_at: new Date().toISOString() }).eq("id", 1);
    await admin.from("app_settings").upsert({ key: "drive", value: { connected: true, email: me.email ?? null, folder_url: folder.webViewLink ?? null, at: new Date().toISOString() } });
    return back("ulandi");
  }

  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  // --- Kunlik avtomatik zaxira: bazadagi rejalashtirgich maxsus kalit bilan chaqiradi ---
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data: l } = await admin.from("drive_link").select("cron_key").eq("id", 1).maybeSingle();
    if (!l?.cron_key || l.cron_key !== cronKey) return json(req, { error: "kalit" }, 401);
    return json(req, await runBackup());
  }
  const user = await whoAmI(req);
  if (!user) return json(req, { error: "Kirish kerak" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* bo'sh */ }
  const action = String(body.action ?? "");

  // --- Ulashni boshlash (faqat admin) ---
  if (action === "start") {
    if (!user.isAdmin) return json(req, { error: "Faqat admin ulaydi" }, 403);
    if (!CID || !CSECRET) return json(req, { error: "Google kalitlari kiritilmagan" }, 400);
    const state = crypto.randomUUID() + crypto.randomUUID();
    await admin.from("drive_link").update({ state, state_user: user.id, state_at: new Date().toISOString() }).eq("id", 1);
    const q = new URLSearchParams({ client_id: CID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state });
    return json(req, { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  }
  if (action === "backup") {
    if (!user.isAdmin) return json(req, { error: "Faqat admin" }, 403);
    const r = await runBackup();
    return json(req, r, "error" in r ? 409 : 200);
  }
  if (action === "disconnect") {
    if (!user.isAdmin) return json(req, { error: "Faqat admin" }, 403);
    await admin.from("drive_link").update({ refresh_token: null, folder_id: null, email: null }).eq("id", 1);
    await admin.from("app_settings").upsert({ key: "drive", value: { connected: false } });
    return json(req, { ok: true });
  }

  // Qolgan amallar: topshiriq shu foydalanuvchiga ko'rinishi shart (RLS orqali tekshiriladi)
  const taskId = String(body.task_id ?? "");
  const { data: task } = await user.asUser.from("tasks").select("id,seq").eq("id", taskId).maybeSingle();
  if (!task) return json(req, { error: "Topshiriq topilmadi" }, 404);
  const acc = await accessToken();
  if (!acc) return json(req, { error: "Drive ulanmagan" }, 409);

  // --- Yuklash seansini ochish: fayl brauzerdan to'g'ridan-to'g'ri Google'ga ketadi ---
  if (action === "session") {
    const name = String(body.name ?? "fayl").replace(/[\\/\u0000-\u001f]/g, " ").slice(0, 180);
    const size = Number(body.size ?? 0), mime = String(body.mime || "application/octet-stream").slice(0, 120);
    if (!(size > 0) || size > MAX_BYTES) return json(req, { error: "Fayl hajmi 200 MB dan oshmasligi kerak" }, 400);
    const r = await g(acc.token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size), Origin: req.headers.get("origin") ?? ORIGINS[0] },
      body: JSON.stringify({ name: `№${task.seq} ${name}`, parents: [acc.folder], appProperties: { devon_task: task.id, devon_user: user.id } }),
    });
    const loc = r.headers.get("location");
    if (!r.ok || !loc) return json(req, { error: "Google seans ochmadi" }, 502);
    return json(req, { upload_url: loc });
  }

  // --- Yuklash tugadi: tekshiramiz, ikkinchi kishiga ko'rish ruxsatini beramiz, ro'yxatga yozamiz ---
  if (action === "done") {
    const fileId = String(body.file_id ?? "");
    const r = await g(acc.token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType,webViewLink,parents,appProperties,trashed`);
    if (!r.ok) return json(req, { error: "Fayl topilmadi" }, 404);
    const f = await r.json();
    if (f.trashed || !(f.parents ?? []).includes(acc.folder) || f.appProperties?.devon_task !== task.id || f.appProperties?.devon_user !== user.id) return json(req, { error: "Fayl bu topshiriqqa tegishli emas" }, 403);
    const { data: users } = await admin.auth.admin.listUsers();
    const { data: link } = await admin.from("drive_link").select("email").eq("id", 1).maybeSingle();
    const { data: profs } = await admin.from("profiles").select("id");
    const ids = new Set((profs ?? []).map((p) => p.id));
    for (const u of users?.users ?? []) {
      if (!ids.has(u.id) || !u.email || u.email === link?.email) continue;
      await g(acc.token, `https://www.googleapis.com/drive/v3/files/${f.id}/permissions?sendNotificationEmail=false`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role: "reader", emailAddress: u.email }),
      });
    }
    const shown = String(f.name).replace(/^№\d+\s/, "");
    const { data: row, error } = await admin.from("attachments").insert({ task_id: task.id, uploader_id: user.id, name: shown, url: f.webViewLink, drive_file_id: f.id, size_bytes: Number(f.size ?? 0), mime: f.mimeType }).select().single();
    if (error) return json(req, { error: "Ro'yxatga yozilmadi" }, 500);
    return json(req, { attachment: row });
  }

  // --- Faylni olib tashlash: Drive savatiga o'tadi (30 kun turadi) ---
  if (action === "remove") {
    const { data: att } = await admin.from("attachments").select("id,uploader_id,drive_file_id,task_id").eq("id", String(body.attachment_id ?? "")).maybeSingle();
    if (!att || att.task_id !== task.id) return json(req, { error: "Topilmadi" }, 404);
    if (att.uploader_id !== user.id && !user.isAdmin) return json(req, { error: "Faqat yuklagan kishi yoki admin olib tashlaydi" }, 403);
    if (att.drive_file_id) await g(acc.token, `https://www.googleapis.com/drive/v3/files/${att.drive_file_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
    await admin.from("attachments").delete().eq("id", att.id);
    return json(req, { ok: true });
  }
  return json(req, { error: "Noma'lum amal" }, 400);
});
