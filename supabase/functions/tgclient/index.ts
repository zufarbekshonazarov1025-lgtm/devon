// deno-lint-ignore-file no-explicit-any
// Zufarbekning Telegram akkauntiga (MTProto) ulanish: kirish va keyinchalik xabarlarni yig'ish
import { createClient } from "npm:@supabase/supabase-js@2";
import { TelegramClient, Api } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions/index.js";
import { computeCheck } from "npm:telegram@2.26.22/Password.js";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const sec = async (n: string) => (await db.from("server_secrets").select("value").eq("name", n).maybeSingle()).data?.value ?? "";
const put = async (n: string, v: string) => { await db.from("server_secrets").upsert({ name: n, value: v, updated_at: new Date().toISOString() }); };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

async function client(sessionName: string) {
  const c = new TelegramClient(new StringSession(await sec(sessionName)), Number(await sec("TG_API_ID")), await sec("TG_API_HASH"), { connectionRetries: 2, deviceModel: "JARVIS (Uchqur)", appVersion: "1.0" });
  await c.connect();
  return c;
}

Deno.serve(async (req) => {
  const cfg = (await db.from("app_settings").select("value").eq("key", "jarvis").maybeSingle()).data?.value as any;
  if (req.headers.get("x-setup-key") !== cfg?.hook_secret) return json({ ok: false }, 403);
  const action = new URL(req.url).searchParams.get("action") || "me";
  const b = await req.json().catch(() => ({}));
  let c: TelegramClient | null = null;
  try {
    if (action === "login_start") {
      const phone = String(b.phone || "").replace(/[^\d+]/g, "");
      if (!/^\+\d{9,15}$/.test(phone)) return json({ ok: false, msg: "Raqamni +998... ko'rinishida yozing." });
      c = await client("TG_LOGIN_TMP_NONE");
      const r: any = await c.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId: Number(await sec("TG_API_ID")), apiHash: await sec("TG_API_HASH"), settings: new Api.CodeSettings({}) }));
      await put("TG_LOGIN_TMP", (c.session as any).save());
      await put("TG_LOGIN_STATE", JSON.stringify({ phone, hash: r.phoneCodeHash, at: Date.now() }));
      return json({ ok: true, msg: "Telegram ilovangizga kirish kodi yuborildi. Uni shu yerga raqamlar orasini ochib yozing, masalan: /kod 1 2 3 4 5" });
    }
    if (action === "login_code" || action === "login_password") {
      const st = JSON.parse((await sec("TG_LOGIN_STATE")) || "{}");
      if (!st.phone || Date.now() - st.at > 15 * 60_000) return json({ ok: false, msg: "Kirish jarayoni eskirgan. Qaytadan /tglogin +998... deb yozing." });
      c = await client("TG_LOGIN_TMP");
      try {
        if (action === "login_code") {
          const code = String(b.code || "").replace(/\D/g, "");
          await c.invoke(new Api.auth.SignIn({ phoneNumber: st.phone, phoneCodeHash: st.hash, phoneCode: code }));
        } else {
          const pwd: any = await c.invoke(new Api.account.GetPassword());
          await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, String(b.password || "")) }));
        }
      } catch (e: any) {
        const m = e?.errorMessage || String(e);
        if (m.includes("SESSION_PASSWORD_NEEDED")) { await put("TG_LOGIN_TMP", (c.session as any).save()); return json({ ok: true, need_password: true, msg: "Akkauntingizda ikki bosqichli parol bor. Uni shunday yozing: /parol SizningParolingiz (xabar darhol o'chiriladi)." }); }
        if (m.includes("PHONE_CODE_INVALID")) return json({ ok: false, msg: "Kod noto'g'ri. Qayta yozing: /kod 1 2 3 4 5" });
        if (m.includes("PHONE_CODE_EXPIRED")) return json({ ok: false, msg: "Kod eskirgan (Telegram uni bekor qilgan bo'lishi mumkin). /tglogin bilan qaytadan boshlang va kodni raqamlar orasini ochib yozing." });
        if (m.includes("PASSWORD_HASH_INVALID")) return json({ ok: false, msg: "Parol noto'g'ri. Qayta yozing: /parol ..." });
        throw e;
      }
      await put("TG_SESSION", (c.session as any).save());
      await put("TG_LOGIN_TMP", ""); await put("TG_LOGIN_STATE", "");
      const me: any = await c.getMe();
      return json({ ok: true, done: true, msg: `✅ Akkaunt ulandi: ${me.firstName ?? ""} ${me.lastName ?? ""}`.trim() });
    }
    if (action === "me") {
      c = await client("TG_SESSION");
      if (!(await c.checkAuthorization())) return json({ ok: false, msg: "Akkaunt hali ulanmagan." });
      const me: any = await c.getMe();
      const dialogs = await c.getDialogs({ limit: 20 });
      return json({ ok: true, me: me.firstName, dialogs: dialogs.length });
    }
    return json({ ok: false, msg: "noma'lum amal" }, 400);
  } catch (e: any) {
    return json({ ok: false, msg: "Xato: " + String(e?.errorMessage || e).slice(0, 200) });
  } finally {
    try { await c?.disconnect(); } catch (_) { /* */ }
  }
});
