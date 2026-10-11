// Devon: biriktirilgan faylni dastur ichida ko'rish. Rasm va PDF o'zi, Word/Excel/PowerPoint PDF ko'rinishida qaytadi.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ORIGINS = ["https://zufarbekshonazarov1025-lgtm.github.io", "https://localhost", "capacitor://localhost"];
const cors = (req: Request) => {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
};
const fail = (req: Request, error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const FOLDER = "application/vnd.google-apps.folder";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return fail(req, "method", 405);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail(req, "Kirish kerak", 401);
  const asUser = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser(auth.slice(7));
  if (!who?.user) return fail(req, "Kirish kerak", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* bo'sh */ }

  // Fayl va uning topshirig'i shu foydalanuvchiga ko'rinishi shart (RLS orqali tekshiriladi)
  const { data: seen } = await asUser.from("attachments").select("id").eq("id", String(body.attachment_id ?? "")).maybeSingle();
  if (!seen) return fail(req, "Fayl topilmadi", 404);
  const { data: att } = await admin.from("attachments").select("id,name,mime,drive_file_id,preview_file_id,size_bytes").eq("id", seen.id).maybeSingle();
  if (!att?.drive_file_id) return fail(req, "Fayl topilmadi", 404);

  const { data: link } = await admin.from("drive_link").select("refresh_token,folder_id,preview_folder_id").eq("id", 1).maybeSingle();
  if (!link?.refresh_token || !link.folder_id) return fail(req, "Drive ulanmagan", 409);
  const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "", refresh_token: link.refresh_token, grant_type: "refresh_token" }) });
  if (!tr.ok) return fail(req, "Drive ruxsati yaroqsiz, qayta ulang", 409);
  const token = (await tr.json()).access_token as string;
  const g = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  const jsonPost = (b: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const alive = async (id: string | null) => { if (!id) return false; const r = await g(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`); return r.ok && !(await r.json()).trashed; };
  const send = (r: Response, type: string) => r.ok
    ? new Response(r.body, { headers: { ...cors(req), "Content-Type": type, "Cache-Control": "private, max-age=300" } })
    : fail(req, "Faylni Drive'dan olib bo'lmadi", 502);

  const mime = String(att.mime ?? ""), ext = (String(att.name).split(".").pop() ?? "").toLowerCase();
  if (mime.startsWith("image/") || mime === "application/pdf") {
    if (Number(att.size_bytes ?? 0) > 40 * 1024 * 1024) return fail(req, "Fayl juda katta, Drive'da oching", 413);
    return send(await g(`https://www.googleapis.com/drive/v3/files/${att.drive_file_id}?alt=media`), mime);
  }
  const target = ["doc", "docx", "odt", "rtf", "txt"].includes(ext) ? "application/vnd.google-apps.document"
    : ["xls", "xlsx", "ods", "csv"].includes(ext) ? "application/vnd.google-apps.spreadsheet"
    : ["ppt", "pptx", "odp"].includes(ext) ? "application/vnd.google-apps.presentation" : null;
  if (!target) return fail(req, "Bu turdagi faylni dastur ichida ko'rsatib bo'lmaydi", 415);

  let copyId = att.preview_file_id as string | null;
  if (!(await alive(copyId))) {
    let pf = link.preview_folder_id as string | null;
    if (!(await alive(pf))) {
      const f = await g("https://www.googleapis.com/drive/v3/files?fields=id", jsonPost({ name: "Ko'rish nusxalari (o'chirmang)", mimeType: FOLDER, parents: [link.folder_id] }));
      if (!f.ok) return fail(req, "Ko'rish papkasini yaratib bo'lmadi", 502);
      pf = (await f.json()).id;
      await admin.from("drive_link").update({ preview_folder_id: pf }).eq("id", 1);
    }
    const c = await g(`https://www.googleapis.com/drive/v3/files/${att.drive_file_id}/copy?fields=id`, jsonPost({ name: `${att.name} (ko'rish)`, mimeType: target, parents: [pf] }));
    if (!c.ok) return fail(req, "Faylni ko'rish uchun aylantirib bo'lmadi. Drive'da oching", 422);
    copyId = (await c.json()).id;
    await admin.from("attachments").update({ preview_file_id: copyId }).eq("id", att.id);
  }
  return send(await g(`https://www.googleapis.com/drive/v3/files/${copyId}/export?mimeType=application/pdf`), "application/pdf");
});
