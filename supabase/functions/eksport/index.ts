// Devon: Excel faylni Google Drive'ga joylash. Telefondagi ilova faylni o'zi saqlay olmaydi,
// shuning uchun dastur yaratgan .xlsx shu yerga yuboriladi, «Devon fayllari» papkasiga yoziladi va havolasi qaytadi.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CSECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const ORIGINS = ["https://zufarbekshonazarov1025-lgtm.github.io", "https://localhost", "capacitor://localhost"];
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const cors = (req: Request) => {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-supabase-api-version", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
};
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const g = (token: string, url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  // Kim so'rayapti: faqat dastur foydalanuvchilari
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(req, { error: "Kirish kerak" }, 401);
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser(auth.slice(7));
  const user = who?.user;
  if (!user) return json(req, { error: "Kirish kerak" }, 401);
  const { data: prof } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!prof) return json(req, { error: "Kirish kerak" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* bo'sh */ }
  const b64 = String(body.data ?? "");
  if (!b64 || b64.length > 14_000_000) return json(req, { error: "Fayl juda katta yoki bo'sh" }, 400);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return json(req, { error: "Fayl buzilgan" }, 400); }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json(req, { error: "Bu Excel fayl emas" }, 400);
  const name = String(body.name ?? "Devon.xlsx").replace(/[\\/\u0000-\u001f]/g, " ").slice(0, 120);

  // Drive kaliti
  const { data: link } = await admin.from("drive_link").select("refresh_token,folder_id,email").eq("id", 1).maybeSingle();
  if (!link?.refresh_token || !link.folder_id) return json(req, { error: "Google Drive ulanmagan" }, 409);
  const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSECRET, refresh_token: link.refresh_token, grant_type: "refresh_token" }) });
  if (!tr.ok) return json(req, { error: "Google Drive ruxsati yo'q, admin qayta ulashi kerak" }, 409);
  const token = (await tr.json()).access_token as string;

  // Yuklash (bir so'rovda: nom + fayl)
  const b = "devon" + crypto.randomUUID(), enc = new TextEncoder();
  const pre = enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [link.folder_id], appProperties: { devon_user: user.id, devon_export: "1" } })}\r\n--${b}\r\nContent-Type: ${MIME}\r\n\r\n`), post = enc.encode(`\r\n--${b}--`);
  const all = new Uint8Array(pre.length + bytes.length + post.length); all.set(pre); all.set(bytes, pre.length); all.set(post, pre.length + bytes.length);
  const up = await g(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body: all });
  if (!up.ok) return json(req, { error: "Drive'ga yuklab bo'lmadi" }, 502);
  const f = await up.json();
  // Drive egasi bo'lmagan foydalanuvchi ham faylni ocha olsin
  if (user.email && user.email !== link.email) {
    await g(token, `https://www.googleapis.com/drive/v3/files/${f.id}/permissions?sendNotificationEmail=false`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role: "reader", emailAddress: user.email }) });
  }
  return json(req, { url: f.webViewLink, name });
});
