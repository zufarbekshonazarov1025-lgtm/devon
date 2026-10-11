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
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
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
