// deno-lint-ignore-file no-explicit-any
// JARVIS — Zufarbekning shaxsiy yordamchisi: Telegram boti + telefon ilovasi
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
let TOKEN = Deno.env.get("JARVIS_BOT_TOKEN") ?? "";
async function loadToken() {
  if (TOKEN) return;
  const { data } = await db.from("server_secrets").select("value").eq("name", "JARVIS_BOT_TOKEN").maybeSingle();
  TOKEN = data?.value ?? "";
}
const GKEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const FN_URL = Deno.env.get("SUPABASE_URL") + "/functions/v1/jarvis";
const MODELS = (Deno.env.get("JARVIS_MODELS") || "gemini-flash-latest,gemini-2.5-flash,gemini-flash-lite-latest").split(",");
const FAST = ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest"];
const ZUF = "4ec5d88a-aded-4ad9-928f-321cc17643ec";
const SAN = "49d75754-abfe-4c95-b4f8-3c696ae949bc";
const TZ = "Asia/Tashkent";
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const who = (s?: string) => (s === "sanjar" ? SAN : ZUF);
const name = (id?: string) => (id === SAN ? "Sanjar og'o" : id === ZUF ? "Zufarbek" : "?");

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await r.json();
}
const setting = async (k: string) => (await db.from("app_settings").select("value").eq("key", k).maybeSingle()).data?.value as any;
async function patchCfg(p: Record<string, unknown>) {
  const cur = (await setting("jarvis")) || {};
  await db.from("app_settings").update({ value: { ...cur, ...p } }).eq("key", "jarvis");
}

function nowLocal() {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const time = d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const wd = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"][new Date(d.toLocaleString("en-US", { timeZone: TZ })).getDay()];
  return { date, time, wd };
}
function b64(buf: Uint8Array) { let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); }
const textOf = (c: any) => (c?.parts || []).map((p: any) => p.text || "").join("").trim();

async function gemini(body: any, models = MODELS) {
  let last = "";
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.trim()}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
      const j = await r.json();
      if (r.ok && j?.candidates?.[0]?.content) return j.candidates[0].content;
      last = `${m}: ${r.status} ${j?.error?.message ?? ""}`;
      if (r.status === 401 || r.status === 403) break;
    } catch (e) { last = `${m}: ${e}`; }
  }
  throw new Error(last || "gemini xato");
}

async function transcribeBytes(bytes: Uint8Array, mime: string) {
  const g = await setting("transcribe_glossary");
  const gl = g ? `\nLUG'AT:\n${(g.terms || []).map((t: string) => "- " + t).join("\n")}\nTUZATISHLAR:\n${(g.corrections || []).map((t: string) => "- " + t).join("\n")}` : "";
  const c = await gemini({ contents: [{ role: "user", parts: [{ text: "Bu Zufarbekning o'z yordamchisi JARVISga bergan ovozli buyrug'i (o'zbekcha, Xorazm shevasi, ba'zan rus so'zlari). Boshidagi \"Hey Jarvis\" chaqiruvini tashlab, qolganini so'zma-so'z o'zbek lotin yozuvida yoz, izohsiz. Hech narsa eshitilmasa bo'sh qaytar." + gl }, { inline_data: { mime_type: mime, data: b64(bytes) } }] }], generationConfig: { temperature: 0 } });
  return textOf(c);
}
async function transcribe(fileId: string, mime: string) {
  const f = await tg("getFile", { file_id: fileId });
  const path = f?.result?.file_path; if (!path) throw new Error("fayl topilmadi");
  const bytes = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`)).arrayBuffer());
  return transcribeBytes(bytes, mime);
}

/** Ovozli javob uchun turkcha og'zaki variant (Zufarbek ovozda turkchani yaxshiroq tushunadi). */
async function toTurkishSpeech(uz: string) {
  try {
    const c = await gemini({ contents: [{ role: "user", parts: [{ text: "Quyidagi o'zbekcha javobni turk tiliga tabiiy, qisqa og'zaki nutq qilib o'gir. Ro'yxat belgilari, emoji va qavslarni olib tashla; raqamli vazifa nomerlarini 'numara' deb ayt. Faqat tarjimani qaytar.\n\n" + uz }] }], generationConfig: { temperature: 0.2 } }, FAST);
    return textOf(c) || uz;
  } catch { return uz; }
}

// ---------- vositalar ----------
const S = (props: any, req: string[] = []) => ({ type: "OBJECT", properties: props, required: req });
const str = (d: string) => ({ type: "STRING", description: d });
const TOOLS = [{ functionDeclarations: [
  { name: "kun_holati", description: "Berilgan kun uchun ikkalasining rejasi, uchrashuvlar, muddati shu kun yoki o'tgan ochiq vazifalar va eslatmalar.", parameters: S({ sana: str("YYYY-MM-DD") }, ["sana"]) },
  { name: "vazifalar", description: "Ochiq vazifalar ro'yxati (izlash mumkin).", parameters: S({ kim: str("men | sanjar | hammasi"), izla: str("sarlavhadan izlash so'zi (ixtiyoriy)"), muddati_otgan: { type: "BOOLEAN" } }) },
  { name: "vazifa_qosh", description: "Devon'ga yangi vazifa. Topshiruvchi odatda Sanjar og'o, Zufarbek o'zinikini desa 'men'.", parameters: S({ nom: str("qisqa nom"), muddat: str("YYYY-MM-DD"), kimga: str("men | sanjar"), kimdan: str("sanjar | men"), izoh: str("ixtiyoriy"), guruh: { type: "INTEGER", description: "Eisenhower: 1 Muhim va shoshilinch, 2 Muhim shoshilinch emas, 3 Shoshilinch muhim emas, 4 Ikkalasi ham emas. Faqat Zufarbek aytsa." } }, ["nom", "muddat"]) },
  { name: "vazifa_bajarildi", description: "Vazifani raqami (№) bo'yicha bajarildi deb yopish.", parameters: S({ raqam: { type: "INTEGER" }, natija: str("ixtiyoriy") }, ["raqam"]) },
  { name: "eslatma_qosh", description: "Devon eslatmasi.", parameters: S({ nom: str("matn"), vaqt: str("YYYY-MM-DDTHH:MM mahalliy vaqt"), ikkalamizga: { type: "BOOLEAN", description: "Sanjar og'oga ham" } }, ["nom", "vaqt"]) },
  { name: "reja_qosh", description: "Kunlik rejaga band qo'shish.", parameters: S({ sana: str("YYYY-MM-DD"), soat: str("HH:MM ixtiyoriy"), nom: str("qisqa"), kim: str("men | sanjar") }, ["sana", "nom"]) },
  { name: "reja_bajarildi", description: "Kunlik rejadagi bandni bajarildi deb belgilash (nomidan izlab).", parameters: S({ sana: str("YYYY-MM-DD"), izla: str("band nomidan so'z") }, ["sana", "izla"]) },
  { name: "uchrashuvlar", description: "Sana oralig'idagi uchrashuvlar.", parameters: S({ dan: str("YYYY-MM-DD"), gacha: str("YYYY-MM-DD") }, ["dan", "gacha"]) },
  { name: "eslab_qol", description: "Zufarbek eslab qolishni so'ragan yoki doimiy foydali fakt.", parameters: S({ fakt: str("qisqa") }, ["fakt"]) },
  { name: "unut", description: "Xotiradan faktni o'chirish (so'z bo'yicha).", parameters: S({ izla: str("so'z") }, ["izla"]) },
] }];

async function openTasks(kim = "hammasi", izla?: string, overdue?: boolean, upto?: string) {
  let q = db.from("tasks").select("seq,title,due_date,status,assignee_id,creator_id,quadrant").is("deleted_at", null).neq("status", "bajarildi").order("due_date").limit(60);
  if (kim === "men") q = q.eq("assignee_id", ZUF); if (kim === "sanjar") q = q.eq("assignee_id", SAN);
  if (izla) q = q.ilike("title", `%${izla}%`);
  if (overdue) q = q.lt("due_date", nowLocal().date);
  if (upto) q = q.lte("due_date", upto);
  const { data } = await q;
  return (data ?? []).map((t: any) => ({ "№": t.seq, nom: t.title, muddat: t.due_date, holat: t.status, kimga: name(t.assignee_id), kimdan: name(t.creator_id), guruh: t.quadrant }));
}

async function runTool(n: string, a: any): Promise<any> {
  switch (n) {
    case "kun_holati": {
      const s = a.sana;
      const [{ data: plan }, { data: ev }, tasks, { data: rem }] = await Promise.all([
        db.from("plan_items").select("at_time,title,done,owner_id").eq("plan_date", s).order("at_time", { nullsFirst: false }),
        db.from("events").select("title,starts_at,ends_at,with_whom,location,owner_id").gte("starts_at", `${s}T00:00:00+05:00`).lte("starts_at", `${s}T23:59:59+05:00`).order("starts_at"),
        openTasks("hammasi", undefined, false, s),
        db.from("reminders").select("title,remind_at,at_time,repeat,for_both").eq("active", true).gte("remind_at", `${s}T00:00:00+05:00`).lte("remind_at", `${s}T23:59:59+05:00`),
      ]);
      return { reja: (plan ?? []).map((p: any) => ({ soat: p.at_time?.slice(0, 5), nom: p.title, bajarildi: p.done, kim: name(p.owner_id) })), uchrashuvlar: (ev ?? []).map((e: any) => ({ nom: e.title, boshlanish: new Date(e.starts_at).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }), kim_bilan: e.with_whom, joy: e.location })), muddati_shu_kungacha_vazifalar: tasks, eslatmalar: rem };
    }
    case "vazifalar": return await openTasks(a.kim, a.izla, a.muddati_otgan);
    case "vazifa_qosh": {
      const { data: mx } = await db.from("tasks").select("seq").order("seq", { ascending: false }).limit(1);
      const row: any = { seq: (mx?.[0]?.seq ?? 0) + 1, title: a.nom, description: a.izoh ?? null, due_date: a.muddat, original_due_date: a.muddat, assignee_id: who(a.kimga), creator_id: a.kimdan === "men" ? ZUF : SAN };
      if (a.guruh) row.quadrant = a.guruh;
      const { data, error } = await db.from("tasks").insert(row).select("seq").single();
      return error ? { xato: error.message } : { ok: true, "№": data.seq };
    }
    case "vazifa_bajarildi": {
      const { data, error } = await db.from("tasks").update({ status: "bajarildi", closed_at: new Date().toISOString(), result: a.natija ?? null, updated_at: new Date().toISOString() }).eq("seq", a.raqam).is("deleted_at", null).select("seq,title");
      return error ? { xato: error.message } : data?.length ? { ok: true, vazifa: data[0].title } : { xato: "bunday raqamli vazifa topilmadi" };
    }
    case "eslatma_qosh": {
      const at = new Date(`${a.vaqt}:00+05:00`);
      const { error } = await db.from("reminders").insert({ owner_id: ZUF, title: a.nom, remind_at: at.toISOString(), at_time: a.vaqt.slice(11, 16), for_both: !!a.ikkalamizga });
      return error ? { xato: error.message } : { ok: true };
    }
    case "reja_qosh": {
      const { error } = await db.from("plan_items").insert({ owner_id: who(a.kim), plan_date: a.sana, at_time: a.soat || null, title: a.nom, added_by: ZUF });
      return error ? { xato: error.message } : { ok: true };
    }
    case "reja_bajarildi": {
      const { data, error } = await db.from("plan_items").update({ done: true, done_at: new Date().toISOString() }).eq("plan_date", a.sana).ilike("title", `%${a.izla}%`).eq("done", false).select("title");
      return error ? { xato: error.message } : { belgilandi: (data ?? []).map((d: any) => d.title) };
    }
    case "uchrashuvlar": {
      const { data } = await db.from("events").select("title,starts_at,with_whom,location").gte("starts_at", `${a.dan}T00:00:00+05:00`).lte("starts_at", `${a.gacha}T23:59:59+05:00`).order("starts_at");
      return (data ?? []).map((e: any) => ({ nom: e.title, vaqt: new Date(e.starts_at).toLocaleString("en-GB", { timeZone: TZ }), kim_bilan: e.with_whom, joy: e.location }));
    }
    case "eslab_qol": { await db.from("jarvis_memory").insert({ fact: a.fakt }); return { ok: true }; }
    case "unut": { const { data } = await db.from("jarvis_memory").delete().ilike("fact", `%${a.izla}%`).select("fact"); return { ochirildi: (data ?? []).length }; }
  }
  return { xato: "noma'lum vosita" };
}

async function think(text: string, voice = false) {
  const t = nowLocal();
  const [{ data: hist }, { data: mem }] = await Promise.all([
    db.from("jarvis_msgs").select("role,text").order("id", { ascending: false }).limit(16),
    db.from("jarvis_memory").select("fact").order("id").limit(200),
  ]);
  const sys = `Sen JARVIS — Zufarbekning shaxsiy sun'iy intellekt yordamchisisan (Temir odam filmidagi kabi). Zufarbek — Uchqur kompaniyasi asoschisi Sanjar og'o (Sanjarbek Tadjiyev)ning shaxsiy assistenti.
Hozir: ${t.date} (${t.wd}), soat ${t.time}, Toshkent vaqti.
XARAKTER: aqlli, xotirjam, hurmatli, ozgina hazil bilan; Zufarbekka "siz" deb murojaat qil. Qisqa yoz (telefon ekrani). Faqat o'zbek lotin yozuvida yoz.${voice ? "\nBu savol OVOZ orqali keldi: javob quloqchinga o'qib beriladi, shuning uchun 1-3 qisqa gap, ro'yxat va belgilarsiz." : ""}
QOIDALAR:
- Ish bajarish kerak bo'lsa, vositalardan foydalan; bajarmagan narsani bajardim dema. Natijani 1-3 qatorda ayt.
- Noaniq bo'lsa (sana, kimga), qisqa so'ra.
- Sanjar og'oning uchrashuvlari 10:00 dan oldin bo'lmaydi; tushlik 12:45–14:10; ish vaqti 09:00–18:00.
- Kunlik reja bandlarini qisqa yoz, bitta ishni mayda bo'laklarga bo'lma; qattiq so'zlarni yumshat ("talab qilish" o'rniga "iltimos qilib so'rash").
- Uchrashuvlarni hozircha faqat o'qiy olasan; yangi uchrashuv qo'shish yoki ko'chirishni so'rasa, buni hozircha Claude orqali qilishini ayt.
- Noto'g'ri yoki xavfli qarorni ko'rsang, hurmat bilan ochiq ayt.
- Doimiy foydali faktni eslab_qol bilan saqla.
XOTIRA:
${(mem ?? []).map((m: any) => "- " + m.fact).join("\n") || "(bo'sh)"}`;
  const contents: any[] = (hist ?? []).reverse().map((m: any) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));
  contents.push({ role: "user", parts: [{ text }] });
  for (let i = 0; i < 6; i++) {
    const c = await gemini({ systemInstruction: { parts: [{ text: sys }] }, contents, tools: TOOLS, generationConfig: { temperature: 0.4 } });
    const calls = (c.parts || []).filter((p: any) => p.functionCall);
    if (!calls.length) return textOf(c) || "...";
    contents.push(c);
    const responses = [];
    for (const p of calls) {
      let res: any; try { res = await runTool(p.functionCall.name, p.functionCall.args || {}); } catch (e) { res = { xato: String(e) }; }
      responses.push({ functionResponse: { name: p.functionCall.name, response: { natija: res } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return "Biroz chalkashib qoldim, iltimos qaytadan ayting.";
}

async function handle(chatId: number, text: string, heard = false) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  let out: string;
  try { out = await think(text); } catch (e) { out = "⚠️ Gemini bilan bog'lanib bo'lmadi: " + String(e).slice(0, 200); }
  await db.from("jarvis_msgs").insert([{ role: "user", text }, { role: "bot", text: out }]);
  await tg("sendMessage", { chat_id: chatId, text: (heard ? `🎙 «${text}»\n\n` : "") + out });
}

/** Telefon ilovasidan kelgan savol: javob + turkcha ovoz matni; Telegram'ga ham nusxa. */
async function fromPhone(cfg: any, text: string) {
  if (!text) return { ok: true, heard: "", text: "Eshitmadim, qaytadan ayting.", speak: "Duyamadım, tekrar söyler misiniz?" };
  let out: string;
  try { out = await think(text, true); } catch (e) { return { ok: false, error: "Gemini: " + String(e).slice(0, 160) }; }
  await db.from("jarvis_msgs").insert([{ role: "user", text }, { role: "bot", text: out }]);
  const speak = await toTurkishSpeech(out);
  tg("sendMessage", { chat_id: cfg.owner_tg_id, text: `📱 «${text}»\n\n${out}`, disable_notification: true }).catch(() => {});
  return { ok: true, heard: text, text: out, speak };
}

Deno.serve(async (req) => {
  await loadToken();
  const cfg = await setting("jarvis");
  const action = new URL(req.url).searchParams.get("action");

  // ---- telefon ilovasi ----
  if (action === "pair") {
    const b = await req.json().catch(() => ({}));
    const p = cfg?.pair;
    if (!p || String(b.code) !== String(p.code) || Date.now() > p.exp) return json({ ok: false, error: "Kod noto'g'ri yoki eskirgan. Telegram'da /ulash deb qayta yozing." });
    const key = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const devices = [...(cfg.devices || []), { key, name: String(b.device || "telefon").slice(0, 60), at: new Date().toISOString() }];
    await patchCfg({ devices, pair: null });
    tg("sendMessage", { chat_id: cfg.owner_tg_id, text: `✅ Telefon ulandi: ${String(b.device || "telefon").slice(0, 60)}` }).catch(() => {});
    return json({ ok: true, key });
  }
  if (action === "voice" || action === "ask") {
    const k = req.headers.get("x-device-key");
    if (!k || !(cfg?.devices || []).some((d: any) => d.key === k)) return json({ ok: false, error: "forbidden" }, 403);
    if (action === "ask") {
      const b = await req.json().catch(() => ({}));
      return json(await fromPhone(cfg, String(b.text || "").trim()));
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length < 2000 || bytes.length > 2_000_000) return json({ ok: false, error: "ovoz hajmi noto'g'ri" });
    let heard = "";
    try { heard = (await transcribeBytes(bytes, req.headers.get("content-type") || "audio/wav")).trim(); } catch (e) { return json({ ok: false, error: "Ovozni o'qib bo'lmadi: " + String(e).slice(0, 160) }); }
    return json(await fromPhone(cfg, heard));
  }

  // ---- sozlash va sinov ----
  if (action === "setup" || action === "test") {
    if (req.headers.get("x-setup-key") !== cfg?.hook_secret) return json({ ok: false }, 403);
    if (!TOKEN) return json({ ok: false, error: "JARVIS_BOT_TOKEN hali saqlanmagan" });
    if (action === "test") {
      const b = await req.json().catch(() => ({}));
      try { return json({ ok: true, javob: await think(b.text || "Bugun nima ishlar bor?") }); } catch (e) { return json({ ok: false, error: String(e) }); }
    }
    const me = await tg("getMe", {});
    const hook = await tg("setWebhook", { url: FN_URL, secret_token: cfg.hook_secret, allowed_updates: ["message"] });
    await tg("setMyCommands", { commands: [{ command: "bugun", description: "Bugungi holat" }, { command: "ertaga", description: "Ertangi holat" }, { command: "ulash", description: "Telefon ilovasini ulash kodi" }, { command: "tozala", description: "Suhbat tarixini tozalash" }] });
    await tg("setMyDescription", { description: "Zufarbekning shaxsiy yordamchisi. Faqat egasiga javob beradi." });
    return json({ ok: true, bot: me?.result?.username, hook });
  }

  // ---- Telegram webhook ----
  if (req.headers.get("x-telegram-bot-api-secret-token") !== cfg?.hook_secret) return json({ ok: false }, 403);
  const upd = await req.json();
  const msg = upd.message;
  if (!msg?.chat?.id) return json({ ok: true });
  if (Number(msg.from?.id) !== Number(cfg.owner_tg_id)) return json({ ok: true });
  if (Number(upd.update_id) <= Number(cfg.last_update_id ?? 0)) return json({ ok: true }); // takroriy yetkazish
  await patchCfg({ last_update_id: upd.update_id });
  try {
    const id = msg.chat.id;
    if (msg.text === "/start") await tg("sendMessage", { chat_id: id, text: "JARVIS tayyor, Zufarbek. Yozing yoki ovozli xabar yuboring." });
    else if (msg.text === "/ulash") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await patchCfg({ pair: { code, exp: Date.now() + 10 * 60_000 } });
      await tg("sendMessage", { chat_id: id, text: `📱 Telefon ilovasi uchun kod: ${code}\n10 daqiqa amal qiladi.` });
    }
    else if (msg.text === "/tozala") { await db.from("jarvis_msgs").delete().gte("id", 0); await tg("sendMessage", { chat_id: id, text: "Suhbat tarixi tozalandi. Xotiradagi faktlar joyida." }); }
    else if (msg.text === "/bugun") await handle(id, "Bugungi holatni qisqa ko'rsat: reja, uchrashuvlar, muddati bugun va o'tgan vazifalar.");
    else if (msg.text === "/ertaga") await handle(id, "Ertangi holatni qisqa ko'rsat: reja, uchrashuvlar, muddati ertaga bo'lgan vazifalar.");
    else if (msg.voice || msg.audio) {
      const v = msg.voice || msg.audio;
      await tg("sendChatAction", { chat_id: id, action: "typing" });
      let heard = "";
      try { heard = await transcribe(v.file_id, v.mime_type || "audio/ogg"); } catch (e) { await tg("sendMessage", { chat_id: id, text: "⚠️ Ovozni o'qib bo'lmadi: " + String(e).slice(0, 200) }); return json({ ok: true }); }
      await handle(id, heard, true);
    } else if (msg.text) await handle(id, msg.text.trim());
  } catch (e) { console.error(e); }
  return json({ ok: true });
});
