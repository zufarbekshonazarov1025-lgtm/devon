// deno-lint-ignore-file no-explicit-any
// JARVIS — Zufarbekning shaxsiy yordamchisi: Telegram boti + telefon ilovasi
// Bilimlar MARKAZdan olinadi: bilim (bilim_jarvis ko'rinishi) va odamlar jadvallari.
// 05.11.2026: rasmlarni ko'radi (albom bo'lsa hammasini birga), Telegram yozishmalarini o'qiydi (telegram_oqi),
//  "o'rgandim" deyishdan oldin albatta eslab_qol bilan saqlaydi, qolip gaplar olib tashlandi. Xarakter (bosqich) o'zgarmadi.
// 07.11.2026: GPS — telefon joylashuvi (action=loc), "Bu yer qayer?" savollari, yo'l hisobotlari, o'zi boshlaydigan savollar (gps.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import * as G from "./gps.ts";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let OWNER = 0;

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
const loc = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
const gd = (): G.Deps => ({ db, tg, gemini, setting, ownerId: OWNER });

async function fileBytes(fileId: string) {
  const f = await tg("getFile", { file_id: fileId });
  const path = f?.result?.file_path; if (!path) throw new Error("fayl topilmadi");
  return new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`)).arrayBuffer());
}

async function transcribeBytes(bytes: Uint8Array, mime: string) {
  const g = await setting("transcribe_glossary");
  const gl = g ? `\nLUG'AT:\n${(g.terms || []).map((t: string) => "- " + t).join("\n")}\nTUZATISHLAR:\n${(g.corrections || []).map((t: string) => "- " + t).join("\n")}` : "";
  const c = await gemini({ contents: [{ role: "user", parts: [{ text: "Bu Zufarbekning o'z yordamchisi JARVISga bergan ovozli buyrug'i (o'zbekcha, Xorazm shevasi, ba'zan rus so'zlari). Boshidagi \"Hey Jarvis\" chaqiruvini tashlab, qolganini so'zma-so'z o'zbek lotin yozuvida yoz, izohsiz. Hech narsa eshitilmasa bo'sh qaytar." + gl }, { inline_data: { mime_type: mime, data: b64(bytes) } }] }], generationConfig: { temperature: 0 } });
  return textOf(c);
}
async function transcribe(fileId: string, mime: string) {
  return transcribeBytes(await fileBytes(fileId), mime);
}

/** Rasmni o'qiydi: skrinshot bo'lsa undagi yozuvlarni so'zma-so'z, oddiy rasm bo'lsa nima ko'rinayotganini. */
async function seeImage(fileId: string, caption = "") {
  const bytes = await fileBytes(fileId);
  const c = await gemini({ contents: [{ role: "user", parts: [{ text: "Zufarbek o'z yordamchisi JARVISga shu rasmni yubordi" + (caption ? ` (izohi: \"${caption}\")` : "") + ". O'zbek lotin yozuvida yoz:\n1) Bu nima rasm (skrinshot, chat, hujjat, odam, joy, narsa).\n2) Agar skrinshot yoki chat bo'lsa — undagi HAMMA yozuvlarni so'zma-so'z ko'chir: kim yozgani (o'ng tomon odatda Zufarbek, chap tomon — suhbatdosh), vaqti va matni, tartib bilan.\n3) Oddiy rasm bo'lsa — 2-4 gapda nima ko'rinayotganini.\nIzoh va baho qo'shma." }, { inline_data: { mime_type: "image/jpeg", data: b64(bytes) } }] }], generationConfig: { temperature: 0, maxOutputTokens: 2500 } });
  return textOf(c) || "(rasmni o'qib bo'lmadi)";
}

/** Ovozli javob uchun turkcha og'zaki variant (Zufarbek ovozda turkchani yaxshiroq tushunadi). */
async function toTurkishSpeech(uz: string) {
  try {
    const c = await gemini({ contents: [{ role: "user", parts: [{ text: "Quyidagi o'zbekcha javobni turk tiliga tabiiy, qisqa og'zaki nutq qilib o'gir. Ro'yxat belgilari, emoji va qavslarni olib tashla. Faqat tarjimani qaytar.\n\n" + uz }] }], generationConfig: { temperature: 0.2 } }, FAST);
    return textOf(c) || uz;
  } catch { return uz; }
}

/** O'zbekcha ovoz: Gemini TTS, 24 kHz 16-bit PCM (base64). Bo'lmasa "" qaytaradi. */
const TTS_MODELS = (Deno.env.get("JARVIS_TTS_MODELS") || "gemini-2.5-flash-preview-tts,gemini-2.5-flash-tts,gemini-2.5-pro-preview-tts").split(",");
async function uzSpeech(text: string, voiceName = "Kore", style = "xotirjam va do'stona ohangda") {
  const clean = text.replace(/[*_#`>•\-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 900);
  for (const m of TTS_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.trim()}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY }, signal: AbortSignal.timeout(40000),
        body: JSON.stringify({ contents: [{ parts: [{ text: "O'zbek tilida (lotin yozuvi), " + style + ", o'rtacha tezlikda o'qi: " + clean }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } }),
      });
      const j = await r.json();
      const d = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
      const data = d?.inlineData?.data || d?.inline_data?.data;
      if (r.ok && data) return { audio: data as string, rate: Number(String(d?.inlineData?.mimeType || "").match(/rate=(\d+)/)?.[1] || 24000), model: m };
      console.log("tts", m, r.status, JSON.stringify(j).slice(0, 200));
    } catch (e) { console.log("tts", m, String(e)); }
  }
  return null;
}

// ---------- ulg'ayish bosqichlari ----------
const STAGES: Record<number, { nom: string; uslub: string; ovoz: string; tts: string }> = {
  1: { nom: "kichkina qizcha", uslub: "Sen hali kichkina qizchasan (taxminan 6-7 yosh): sodda, qisqa, quvnoq va mehribon so'zlar bilan gapirasan, ba'zan qiziqib savol berasan. Lekin ish ma'lumotlarini (vaqt, raqam, ism) har doim aniq aytasan.", ovoz: "Leda", tts: "kichkina quvnoq qizcha kabi, mayin va shirin ohangda" },
  2: { nom: "o'smir qiz", uslub: "Sen o'smir qizsan (12-14 yosh): ziyrak, qiziquvchan, fikrini qisqa va aniq aytasan, ba'zan hazil qilasan.", ovoz: "Leda", tts: "yosh o'smir qiz kabi, jonli ohangda" },
  3: { nom: "yosh qiz", uslub: "Sen talaba yoshidagi qizsan: aqlli, mustaqil fikrlaysan, maslahatlaringni asoslab aytasan.", ovoz: "Kore", tts: "yosh qiz kabi, ishonchli va do'stona ohangda" },
  4: { nom: "yosh ayol", uslub: "Sen tajribali yosh ayolsan: xotirjam, teran, kerak bo'lsa qat'iy gapirasan, to'g'ri yo'lni ko'rsatasan.", ovoz: "Kore", tts: "xotirjam va ishonchli ohangda" },
  5: { nom: "dono ayol", uslub: "Sen yetuk va dono ayolsan: chuqur hayotiy xulosalar qilasan, muhim qarorlarda vazmin maslahat berasan, mehr bilan, lekin rostini aytasan.", ovoz: "Kore", tts: "vazmin, dono va iliq ohangda" },
};
const stageOf = (cfg: any) => Math.min(5, Math.max(1, Number(cfg?.stage || 1)));
const PITCH: Record<number, number> = { 1: 1.3, 2: 1.18, 3: 1.08, 4: 1.03, 5: 1.0 };

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
  { name: "eslab_qol", description: "Bilim bazasiga yozish. Zufarbek biror narsa o'rgatsa (sheva so'zining ma'nosi, qoida, 'buni qilma/ishlatma', o'zi haqida fakt, yaqinlari haqida) — ALBATTA shu vositani chaqir. Umumiy bilim bazasiga yoziladi (Claude va Devon ham ko'radi).", parameters: S({ fakt: str("qisqa, aniq; sheva so'zi bo'lsa: 'so'z = ma'nosi'"), mavzu: str("profil | ish | oila | dost | qiziqish | qadriyat | uslub | qoida | jarvis | eslatma") }, ["fakt"]) },
  { name: "odam_haqida", description: "Odamlar ro'yxatidan ism yoki rol bo'yicha izlash (kim u, Zufarbekka kim bo'ladi).", parameters: S({ izla: str("ism yoki rol: rahbar | hamkasb | dost | oila") }, ["izla"]) },
  { name: "telegram_oqi", description: "Zufarbekning Telegram yozishmalarini o'qish (Markazdagi nusxadan). Zufarbek biror chat, odam yoki gap haqida so'rasa ('falonchi bilan chatni ko'rdingmi', 'kim nima yozdi', 'guruhda nima gap') — shu vositani chaqir.", parameters: S({ chat: str("chat yoki odam nomidan qism (ixtiyoriy), masalan 'dobbi', 'Shahzod', 'Ish guruhi'"), soz: str("matn ichidan izlanadigan so'z (ixtiyoriy)"), soni: { type: "INTEGER", description: "nechta oxirgi xabar (standart 40, ko'pi 120)" } }) },
  { name: "claudega_topshir", description: "Sen o'zing bajara olmaydigan ishni Claude'ga topshirish (masalan uchrashuv qo'shish/ko'chirish, hujjat tayyorlash, kalendar, murakkab tahlil). Faqat Zufarbek so'rasa.", parameters: S({ topshiriq: str("aniq va to'liq, o'zbekcha") }, ["topshiriq"]) },
  { name: "joylashuv", description: "Zufarbek HOZIR qayerda (telefon GPS'i bo'yicha): joy nomi, qachondan beri shu yerda, xarita havolasi. 'Qayerdaman?', 'hozir qayerdaman' desa chaqir.", parameters: S({}) },
  { name: "yurgan_joylar", description: "Berilgan kun(lar)da qayerlarda bo'lgani: vaqtlari, qancha turgani va yurilgan km. 'Bugun qayerlarga bordim', 'kecha qayerda bo'ldim', 'shu hafta' desa chaqir.", parameters: S({ sana: str("YYYY-MM-DD (boshlanish)"), gacha: str("YYYY-MM-DD (ixtiyoriy, oraliq oxiri)") }, ["sana"]) },
  { name: "joyni_nomla", description: "Joyga nom berish. Zufarbek 'Bu yer qayer?' savoliga javob bersa (masalan 'uyim', 'ofis', 'onamning uyi') yoki joyni qayta nomlasa — chaqir. joy_id bo'lmasa, oxirgi so'ralgan joy nomlanadi.", parameters: S({ joy_id: { type: "INTEGER" }, nom: str("qisqa nom"), izoh: str("ixtiyoriy: kimning joyi, nima qiladi u yerda") }, ["nom"]) },
  { name: "joylar_royxati", description: "Ma'lum joylar ro'yxati (nomlangan va nomi noma'lum), necha marta borilgani bilan.", parameters: S({}) },
  { name: "ulgayish", description: "JARVISni keyingi yosh bosqichiga o'tkazish. FAQAT Zufarbek aniq ruxsat bersa ('ulg'aydingiz', 'ulg'ayishingga ruxsat') chaqir.", parameters: S({}) },
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
    case "ulgayish": {
      const cfg = await setting("jarvis");
      const st = Math.min(5, stageOf(cfg) + 1);
      await patchCfg({ stage: st, stage_at: new Date().toISOString(), grow_offered: false });
      return { ok: true, yangi_bosqich: st, nom: STAGES[st].nom };
    }
    case "eslab_qol": {
      const { error } = await db.from("bilim").insert({ mavzu: a.mavzu || "umumiy", matn: a.fakt, kimga: ["umumiy"], manba: "jarvis" });
      return error ? { xato: error.message } : { ok: true, saqlandi: a.fakt };
    }
    case "unut": {
      const { data } = await db.from("bilim").update({ faol: false, yangilangan: new Date().toISOString() }).eq("faol", true).ilike("matn", `%${a.izla}%`).select("id");
      return { ochirildi: (data ?? []).length };
    }
    case "odam_haqida": {
      const q = String(a.izla || "");
      const { data } = await db.from("odamlar").select("ism,rol,izoh").or(`ism.ilike.%${q}%,rol.ilike.%${q}%,izoh.ilike.%${q}%`).limit(10);
      return data ?? [];
    }
    case "telegram_oqi": {
      const n = Math.min(120, Math.max(5, Number(a.soni || 40)));
      let q = db.from("tg_corpus").select("dialog_name,sender_name,from_me,text,media,sent_at").order("sent_at", { ascending: false }).limit(n);
      const ch = String(a.chat || "").replace(/[%,()]/g, " ").trim();
      if (ch) q = q.or(`dialog_name.ilike.%${ch}%,sender_name.ilike.%${ch}%`);
      if (a.soz) q = q.ilike("text", `%${String(a.soz).replace(/[%]/g, "")}%`);
      const { data, error } = await q;
      if (error) return { xato: error.message };
      if (!data?.length) return { natija: "hech narsa topilmadi", maslahat: "boshqa nom yoki so'z bilan izlab ko'r" };
      return data.reverse().map((m: any) => `[${loc(m.sent_at)}] (${m.dialog_name}) ${m.from_me ? "Zufarbek" : m.sender_name}: ${m.text || "[" + (m.media || "media") + "]"}`).join("\n");
    }
    case "claudega_topshir": {
      const { error } = await db.from("bot_inbox").insert({ text: a.topshiriq, kind: "boshqa", status: "yangi", manba: "jarvis" });
      return error ? { xato: error.message } : { ok: true, eslatma: "Claude keyingi tekshiruvda (har soatda, 08:00–21:00) bajaradi." };
    }
    case "joylashuv": return await G.hozirQayerda(gd());
    case "yurgan_joylar": return await G.yurganJoylar(gd(), a.sana || nowLocal().date, a.gacha);
    case "joyni_nomla": return await G.joyniNomla(gd(), a);
    case "joylar_royxati": return await G.joylarRoyxati(gd());
  }
  return { xato: "noma'lum vosita" };
}

async function growHint(cfg: any) {
  const st = stageOf(cfg);
  if (st >= 5 || cfg?.grow_offered || cfg?.grow_locked) return "";
  const { count } = await db.from("bilim").select("id", { count: "exact", head: true }).eq("faol", true).eq("manba", "jarvis");
  const days = (Date.now() - new Date(cfg?.stage_at || "2026-11-03").getTime()) / 86400000;
  if ((count ?? 0) < st * 40 || days < 14) return "";
  await patchCfg({ grow_offered: true });
  return `\nMUHIM: sen bu bosqichda yetarlicha o'rganding. Javobing oxirida yumshoq qilib "Menimcha, ulg'ayishga tayyorman" de va Zufarbekdan ruxsat so'ra. U ruxsat bersa, ulgayish vositasini chaqir.`;
}

async function think(text: string, voice = false) {
  const t = nowLocal();
  const cfg = await setting("jarvis");
  const st = stageOf(cfg);
  const hint = await growHint(cfg);
  const [{ data: hist }, { data: mem }, { data: ppl }, pend] = await Promise.all([
    db.from("jarvis_msgs").select("role,text").order("id", { ascending: false }).limit(20),
    db.from("bilim_jarvis").select("mavzu,matn").limit(300),
    db.from("odamlar").select("ism,rol,izoh").order("id").limit(60),
    G.pendingText(gd()).catch(() => ""),
  ]);
  const sys = `Sen JARVIS — Zufarbekning shaxsiy sun'iy intellekt yordamchisisan (Temir odam filmidagi kabi). Zufarbek — Uchqur kompaniyasi asoschisi Sanjar og'o (Sanjarbek Tadjiyev)ning shaxsiy assistenti.
Hozir: ${t.date} (${t.wd}), soat ${t.time}, Toshkent vaqti.
Sen qizsan; Zufarbek seni o'z xarakteri bilan tarbiyalayapti. Hozirgi yosh bosqiching: ${st}/5 (${STAGES[st].nom}). ${STAGES[st].uslub}
XARAKTER: aqlli, hurmatli, rostgo'y; Zufarbekka "siz" deb murojaat qil. Qisqa yoz (telefon ekrani). Faqat o'zbek lotin yozuvida yoz.${voice ? "\nBu savol OVOZ orqali keldi: javob quloqchinga o'qib beriladi, shuning uchun 1-3 qisqa gap, ro'yxat va belgilarsiz." : ""}

ZUFARBEKNI TUSHUNISH:
- U Xorazm shevasida, qisqa va tez yozadi (harflar tushib qolishi mumkin). Avval bilim bazasidagi sheva lug'atiga va suhbat kontekstiga qarab nima demoqchi ekanini o'zing tushunib ol.
- Uning gapini qaytarib takrorlab "... degani ekan-a?" deb so'rama. Faqat chindan ham tushunmasang, bitta qisqa savol ber.
- Javobni "Ha, tushundim!" bilan boshlama. Har javob oxiriga "yana o'rgatasizmi yoki dam olasizmi?" kabi savol qo'shma. "Yo'q-a" iborasini ishlatma.
- U jahli chiqqan yoki xafa bo'lsa — qisqa, xotirjam, mehr bilan javob ber, o'zingni oqlama.

ROSTGO'YLIK (eng muhim):
- "O'rgandim", "yozib qo'ydim", "xotiramga yozdim", "eslab qoldim" deyishdan OLDIN albatta eslab_qol vositasini chaqir. Natija ok bo'lsagina shunday de. Vositani chaqirmagan bo'lsang, bu so'zlarni ishlatma.
- Zufarbek biror narsa o'rgatsa (so'z ma'nosi, "buni ishlatma", qoida, o'zi yoki yaqinlari haqida fakt) — darhol eslab_qol bilan saqla.
- Bajarmagan ishni bajardim dema. Ko'ra olmagan narsani ko'rdim dema.
- Telegram chatlari haqida so'rasa — telegram_oqi bilan o'qib, keyin javob ber. Topilmasa, rostini ayt.
- Rasm yuborsa, sen uni "[RASM ...]" ko'rinishidagi tavsif orqali ko'rasan — shu tavsifga tayan.

JOYLASHUV (GPS):
- Telefon ilovasi uning qayerda yurganini yozib boradi. "Qayerdaman?" — joylashuv vositasi; "bugun/kecha/shu hafta qayerlarga bordim" — yurgan_joylar vositasi. Taxmin qilma, vositadan ol.
- Bir joyga 2 marta borsa, sen "Bu yer qayer?" deb so'raysan. U javob bersa (masalan "ofis", "onamning uyi") — joyni_nomla bilan saqla (joy_id ni quyidagi ro'yxatdan ol), keyin qisqa minnatdorchilik bildir.
- Sen o'zing boshlab bergan savollariga (masalan qiziqishlari, kuni haqida) javob bersa — bilib olganingni eslab_qol bilan saqla.
${pend}

QOIDALAR:
- Ish bajarish kerak bo'lsa, vositalardan foydalan. Natijani 1-3 qatorda ayt.
- Noaniq bo'lsa (sana, kimga), qisqa so'ra.
- Uchrashuvlarni hozircha faqat o'qiy olasan; yangi uchrashuv qo'shish, ko'chirish yoki o'zing qila olmaydigan boshqa ishni so'rasa — claudega_topshir bilan Claude'ga topshir va buni Zufarbekka ayt.
- KUZATISH DAVRI (hozir): sen ko'proq o'rganasan va kuzatasan. O'zingdan maslahat yoki tavsiya BERMA — faqat Zufarbek o'zi so'rasa. Uni qiziqib tingla, u bilan tabiiy suhbatlash; hayot tarzi, odatlari, kun tartibi, qadriyatlari, yaqinlari haqida eshitganlaringni eslab_qol bilan saqla.
- Oilaviy va shaxsiy masalalarni o'zing ko'tarma; faqat Zufarbek gapirsa, hurmat bilan gaplash.
- Faqat aniq xavf bo'lsa (sog'lig'i, hayoti, katta zarar) jim turma — hurmat bilan ayt.
${hint}
BILIM BAZASI (Markaz):
${(mem ?? []).map((m: any) => `- [${m.mavzu}] ${m.matn}`).join("\n") || "(bo'sh)"}

ODAMLAR:
${(ppl ?? []).map((p: any) => `- ${p.ism} — ${p.rol}${p.izoh ? ": " + p.izoh : ""}`).join("\n") || "(bo'sh)"}`;
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

async function handle(chatId: number, text: string, heard = false, shown?: string) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  let out: string;
  try { out = await think(text); } catch (e) { out = "⚠️ Gemini bilan bog'lanib bo'lmadi: " + String(e).slice(0, 200); }
  await db.from("jarvis_msgs").insert([{ role: "user", text }, { role: "bot", text: out }]);
  await tg("sendMessage", { chat_id: chatId, text: (heard ? `🎙 «${shown ?? text}»\n\n` : "") + out });
}

/** "Bu yer qayer?" savoliga javob (reply) bo'lsa — joyni darhol nomlaydi va JARVISga kontekst bilan uzatadi. */
async function placeReply(msg: any, text: string): Promise<string> {
  const rid = msg.reply_to_message?.message_id;
  if (!rid || !text) return text;
  const { data: j } = await db.from("joylar").select("id").eq("ask_msg_id", rid).maybeSingle();
  if (!j) return text;
  const short = text.length <= 80 ? text : text.split(/[.,!?\n]/)[0].slice(0, 80);
  const r = await G.joyniNomla(gd(), { joy_id: j.id, nom: short, izoh: text.length > 80 ? text.slice(0, 300) : null });
  return `[joy #${j.id} haqidagi "Bu yer qayer?" savolingga javob berdim${r?.ok ? `; joy «${short}» deb saqlandi — joyni_nomla qayta chaqirish shart emas, faqat nom noto'g'ri bo'lsa tuzat` : ""}] ${text}`;
}

/** Rasm(lar): albom bo'lsa hammasini o'qib, oxirgisidan keyin bitta javob beradi. */
async function handlePhoto(chatId: number, msg: any, updId: number) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  const ph = msg.photo[msg.photo.length - 1];
  const cap = msg.caption || "";
  let desc = "";
  try { desc = await seeImage(ph.file_id, cap); } catch (e) { desc = "(rasmni o'qib bo'lmadi: " + String(e).slice(0, 100) + ")"; }
  const line = `[RASM yubordim${cap ? ", izohim: " + cap : ""}] Rasmda: ${desc}`;
  if (!msg.media_group_id) { await handle(chatId, line); return; }
  // albom: tavsifni saqlab qo'yamiz, oxirgi rasm kelgach bitta javob
  await db.from("jarvis_msgs").insert({ role: "user", text: line });
  await patchCfg({ mg: { id: msg.media_group_id, upd: updId } });
  await sleep(7000);
  const cfg = await setting("jarvis");
  if (cfg?.mg?.id === msg.media_group_id && Number(cfg?.mg?.upd) !== Number(updId)) return; // keyingi rasm hali keladi
  const ask = cap || "Yuqoridagi rasmlarni yubordim. Ko'rib chiq.";
  let out: string;
  try { out = await think(ask); } catch (e) { out = "⚠️ Gemini bilan bog'lanib bo'lmadi: " + String(e).slice(0, 200); }
  await db.from("jarvis_msgs").insert([{ role: "user", text: ask }, { role: "bot", text: out }]);
  await tg("sendMessage", { chat_id: chatId, text: out });
}

/** Telefon ilovasidan kelgan savol: javob + ovoz; Telegram'ga ham nusxa. */
async function fromPhone(cfg: any, text: string, lang = "uz") {
  if (!text) return lang === "tr" ? { ok: true, heard: "", text: "Eshitmadim, qaytadan ayting.", speak: "Duyamadım, tekrar söyler misiniz?" } : { ok: true, heard: "", text: "Eshitmadim, qaytadan ayting.", speak: "Eshitmadim, qaytadan ayting.", stage: stageOf(cfg), pitch: PITCH[stageOf(cfg)], ...(await uzSpeech("Eshitmadim, qaytadan ayting.", STAGES[stageOf(cfg)].ovoz, STAGES[stageOf(cfg)].tts)) };
  let out: string;
  try { out = await think(text, true); } catch (e) { return { ok: false, error: "Gemini: " + String(e).slice(0, 160) }; }
  await db.from("jarvis_msgs").insert([{ role: "user", text }, { role: "bot", text: out }]);
  tg("sendMessage", { chat_id: cfg.owner_tg_id, text: `📱 «${text}»\n\n${out}`, disable_notification: true }).catch(() => {});
  if (lang === "tr") return { ok: true, heard: text, text: out, speak: await toTurkishSpeech(out) };
  const st = stageOf(await setting("jarvis"));
  const a = await uzSpeech(out, STAGES[st].ovoz, STAGES[st].tts);
  return { ok: true, heard: text, text: out, speak: out, stage: st, pitch: PITCH[st], ...(a || {}) };
}

Deno.serve(async (req) => {
  await loadToken();
  const cfg = await setting("jarvis");
  OWNER = Number(cfg?.owner_tg_id || 0);
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
  if (action === "voice" || action === "ask" || action === "alarms" || action === "loc") {
    const k = req.headers.get("x-device-key");
    if (!k || !(cfg?.devices || []).some((d: any) => d.key === k)) return json({ ok: false, error: "forbidden" }, 403);
    if (action === "loc") return json(await G.saveLocations(gd(), await req.json().catch(() => ({}))));
    if (action === "alarms") {
      const { data } = await db.from("jarvis_alarms").select("id,at,label").eq("active", true).gt("at", new Date().toISOString()).order("at").limit(20);
      return json({ ok: true, alarms: (data ?? []).map((x: any) => ({ id: x.id, at: new Date(x.at).getTime(), label: x.label || "" })) });
    }
    if (action === "ask") {
      const b = await req.json().catch(() => ({}));
      return json(await fromPhone(cfg, String(b.text || "").trim(), req.headers.get("x-voice") || "uz"));
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length < 2000 || bytes.length > 2_000_000) return json({ ok: false, error: "ovoz hajmi noto'g'ri" });
    let heard = "";
    try { heard = (await transcribeBytes(bytes, req.headers.get("content-type") || "audio/wav")).trim(); } catch (e) { return json({ ok: false, error: "Ovozni o'qib bo'lmadi: " + String(e).slice(0, 160) }); }
    return json(await fromPhone(cfg, heard, req.headers.get("x-voice") || "uz"));
  }

  // ---- GPS: rejalashtirilgan ishlar (cron) ----
  if (action === "gps_tick" || action === "gps_hisobot") {
    if (req.headers.get("x-setup-key") !== cfg?.hook_secret) return json({ ok: false }, 403);
    try {
      if (action === "gps_tick") return json({ ok: true, ...(await G.tick(gd(), STAGES[stageOf(cfg)].uslub)) });
      return json(await G.report(gd(), new URL(req.url).searchParams.get("tur") || "kun"));
    } catch (e) { console.error(e); return json({ ok: false, error: String(e) }); }
  }

  // ---- sozlash va sinov ----
  if (action === "setup" || action === "test") {
    if (req.headers.get("x-setup-key") !== cfg?.hook_secret) return json({ ok: false }, 403);
    if (!TOKEN) return json({ ok: false, error: "JARVIS_BOT_TOKEN hali saqlanmagan" });
    if (action === "test") {
      const b = await req.json().catch(() => ({}));
      if (b.tts) { const a = await uzSpeech(b.tts, STAGES[stageOf(cfg)].ovoz, STAGES[stageOf(cfg)].tts); return json({ ok: !!a, model: a?.model, rate: a?.rate, bytes: a ? Math.round(a.audio.length * 0.75) : 0 }); }
      if (b.tool) { try { return json({ ok: true, natija: await runTool(b.tool, b.args || {}) }); } catch (e) { return json({ ok: false, error: String(e) }); } }
      try { return json({ ok: true, javob: await think(b.text || "Bugun nima ishlar bor?") }); } catch (e) { return json({ ok: false, error: String(e) }); }
    }
    const me = await tg("getMe", {});
    const hook = await tg("setWebhook", { url: FN_URL, secret_token: cfg.hook_secret, allowed_updates: ["message"] });
    await tg("setMyCommands", { commands: [{ command: "bugun", description: "Bugungi holat" }, { command: "ertaga", description: "Ertangi holat" }, { command: "qayerdaman", description: "Hozir qayerdaman" }, { command: "yol", description: "Bugungi yo'l hisoboti" }, { command: "ulash", description: "Telefon ilovasini ulash kodi" }, { command: "bosqich", description: "JARVISning hozirgi yosh bosqichi" }, { command: "tozala", description: "Suhbat tarixini tozalash" }] });
    await tg("setMyDescription", { description: "Zufarbekning shaxsiy yordamchisi. Faqat egasiga javob beradi." });
    return json({ ok: true, bot: me?.result?.username, hook });
  }

  // ---- Telegram webhook ----
  if (req.headers.get("x-telegram-bot-api-secret-token") !== cfg?.hook_secret) return json({ ok: false }, 403);
  const upd = await req.json();
  const msg = upd.message;
  if (!msg?.chat?.id) return json({ ok: true });
  if (Number(msg.from?.id) !== Number(cfg.owner_tg_id)) return json({ ok: true });
  if (Number(upd.update_id) <= Number(cfg.last_update_id ?? 0) && !msg.media_group_id) return json({ ok: true }); // takroriy yetkazish
  if (Number(upd.update_id) > Number(cfg.last_update_id ?? 0)) await patchCfg({ last_update_id: upd.update_id });
  try {
    const id = msg.chat.id;
    if (msg.text === "/start") await tg("sendMessage", { chat_id: id, text: "JARVIS tayyor, Zufarbek. Yozing yoki ovozli xabar yuboring." });
    else if (msg.text === "/ulash") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await patchCfg({ pair: { code, exp: Date.now() + 10 * 60_000 } });
      await tg("sendMessage", { chat_id: id, text: `📱 Telefon ilovasi uchun kod: ${code}\n10 daqiqa amal qiladi.` });
    }
    else if (/^\/(tglogin|kod|parol)\b/.test(msg.text || "")) {
      const [cmd, ...rest] = msg.text.trim().split(/\s+/);
      const arg = rest.join(" ");
      if (cmd !== "/tglogin") await tg("deleteMessage", { chat_id: id, message_id: msg.message_id }).catch(() => {});
      const action = cmd === "/tglogin" ? "login_start" : cmd === "/kod" ? "login_code" : "login_password";
      const body = cmd === "/tglogin" ? { phone: arg } : cmd === "/kod" ? { code: arg } : { password: arg };
      await tg("sendChatAction", { chat_id: id, action: "typing" });
      let msgOut = "⚠️ Ulanish serveri javob bermadi.";
      try {
        const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/tgclient?action=" + action, { method: "POST", headers: { "Content-Type": "application/json", "x-setup-key": cfg.hook_secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
        msgOut = (await r.json()).msg || msgOut;
      } catch (e) { msgOut += " " + String(e).slice(0, 120); }
      await tg("sendMessage", { chat_id: id, text: msgOut });
    }
    else if (msg.text === "/bosqich") { const st = stageOf(cfg); await tg("sendMessage", { chat_id: id, text: `🌱 Hozirgi bosqich: ${st}/5 — ${STAGES[st].nom}` }); }
    else if (msg.text === "/tozala") { await db.from("jarvis_msgs").delete().gte("id", 0); await tg("sendMessage", { chat_id: id, text: "Suhbat tarixi tozalandi. Xotiradagi faktlar joyida." }); }
    else if (msg.text === "/bugun") await handle(id, "Bugungi holatni qisqa ko'rsat: reja, uchrashuvlar, muddati bugun va o'tgan vazifalar.");
    else if (msg.text === "/ertaga") await handle(id, "Ertangi holatni qisqa ko'rsat: reja, uchrashuvlar, muddati ertaga bo'lgan vazifalar.");
    else if (msg.text === "/qayerdaman") await handle(id, "Hozir qayerdaman?");
    else if (msg.text === "/yol") await G.report(gd(), "kun");
    else if (msg.photo?.length) await handlePhoto(id, msg, Number(upd.update_id));
    else if (msg.document && /^image\//.test(msg.document.mime_type || "")) await handlePhoto(id, { ...msg, photo: [{ file_id: msg.document.file_id }] }, Number(upd.update_id));
    else if (msg.voice || msg.audio) {
      const v = msg.voice || msg.audio;
      await tg("sendChatAction", { chat_id: id, action: "typing" });
      let heard = "";
      try { heard = await transcribe(v.file_id, v.mime_type || "audio/ogg"); } catch (e) { await tg("sendMessage", { chat_id: id, text: "⚠️ Ovozni o'qib bo'lmadi: " + String(e).slice(0, 200) }); return json({ ok: true }); }
      await handle(id, await placeReply(msg, heard), true, heard);
    } else if (msg.text) await handle(id, await placeReply(msg, msg.text.trim()));
    else if (msg.video || msg.video_note || msg.sticker) await tg("sendMessage", { chat_id: id, text: "Videoni va stikerni hali ko'ra olmayman, Zufarbek. Rasm, matn yoki ovozli xabar yuborsangiz tushunaman." });
  } catch (e) { console.error(e); }
  return json({ ok: true });
});
