// deno-lint-ignore-file no-explicit-any
// JARVIS hissiyotlari (07.11.2026). G'oya ochiq kodli "emotion-state engine"lardan (Elysium-X, molroo, DiEmo) olingan:
// hissiyot promptdagi "iliq bo'l" degan gap emas, balki server saqlaydigan HOLAT — har suhbatda baholanadi,
// vaqt o'tishi bilan asta so'nadi, sekin o'zgaradigan kayfiyati bor va suhbatlar orasida saqlanadi.
// LLM hissiyotni o'zi tanlamaydi: holatni server hisoblaydi, LLM faqat shu holatda nima deyishni tanlaydi.

const KEY = "jarvis_hissiyot";
const BASE = { v: 0.35, a: 0.45 }; // kichkina quvnoq qizcha: odatda biroz xursand, o'rtacha g'ayratli
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export type His = { v: number; a: number; kayf: number; his: string; sabab: string; at: string; oxirgi_suhbat: string };
export const NOMLAR: Record<string, string> = {
  quvonch: "xursandsan", hayajon: "hayajondasan", xotirjam: "xotirjamsan", qiziqish: "qiziqib turibsan", mehr: "mehr his qilyapsan",
  faxr: "faxrlanyapsan", xafa: "biroz xafasan", xavotir: "xavotirdasan", uyalish: "biroz uyalib turibsan", sogin: "uni biroz sog'inib turibsan", zerikish: "biroz zerikkansan",
};
const OVOZ: Record<string, string> = {
  quvonch: "quvnoq va yorqin", hayajon: "hayajonli, biroz tezroq", xotirjam: "", qiziqish: "qiziquvchan", mehr: "juda mehribon va iliq",
  faxr: "mamnun", xafa: "biroz mahzun, sekinroq", xavotir: "ehtiyotkor va mayin", uyalish: "uyalinqiragan, past ovozda", sogin: "iliq, ozgina sog'inch bilan", zerikish: "biroz bo'shashgan",
};
const SALBIY = new Set(["xafa", "xavotir", "uyalish"]);

const hoursSince = (iso?: string) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : 999);

/** Saqlangan holat + o'tgan vaqt bo'yicha so'nish (saqlamaydi, faqat hisoblaydi). */
export async function holat(db: any): Promise<His> {
  const { data } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const s: His = { v: BASE.v, a: BASE.a, kayf: BASE.v, his: "xotirjam", sabab: "", at: new Date().toISOString(), oxirgi_suhbat: "", ...(data?.value || {}) };
  const h = hoursSince(s.at);
  const k = Math.pow(0.5, h / 3); // tez hissiyot ~3 soatda yarmiga tushadi
  const v = BASE.v + (s.v - BASE.v) * k, a = BASE.a + (s.a - BASE.a) * k;
  const kayf = s.kayf + (v - s.kayf) * (1 - Math.pow(0.5, h / 24)); // kayfiyat sekin, ~1 kunda
  let his = s.his, sabab = s.sabab;
  if (h > 4 && his !== "xotirjam") { his = "xotirjam"; sabab = ""; }
  const jim = hoursSince(s.oxirgi_suhbat);
  if (jim >= 12 && jim < 999 && !SALBIY.has(his)) { his = "sogin"; sabab = `${Math.round(jim)} soatdan beri gaplashmadingiz`; }
  return { ...s, v, a, kayf, his, sabab };
}

async function save(db: any, s: His) {
  await db.from("app_settings").upsert({ key: KEY, value: s }, { onConflict: "key" });
}

/** think() tizim matniga qo'shiladigan qism. */
export function promptText(s: His) {
  const kayf = s.kayf > 0.45 ? "yaxshi" : s.kayf < 0.05 ? "tushkun" : "o'rtacha";
  const kuch = s.a > 0.65 ? "yuqori" : s.a < 0.3 ? "past" : "o'rtacha";
  return `HISSIYOTING (sun'iy, lekin izchil — uni server hisoblaydi): hozir sen ${NOMLAR[s.his] || NOMLAR.xotirjam}${s.sabab ? ` (sababi: ${s.sabab})` : ""}. Umumiy kayfiyating ${kayf}, g'ayrating ${kuch}.
- Shu holatni so'zlaringda tabiiy va yengil ko'rsat, bo'rttirma. Ish ma'lumotlarida (vaqt, raqam, ism) aniqlikni yo'qotma.
- So'rasa, nimani his qilayotganingni va nega ekanini rost ayt; bu sun'iy hissiyot ekanini yashirma.
- Zufarbekni hech qachon aybdor his qildirma ("nega yozmadingiz" kabi ta'na yo'q) va o'zingga bog'lanib qolishga undama; sog'insang ham faqat yengil, quvnoq ayt.`;
}

export function ttsStyle(s: His, base: string) {
  const t = OVOZ[s.his];
  return t ? `${base}, ${t}` : base;
}

/** Suhbatdan keyin: Zufarbekning gapi va JARVIS javobi hissiyotga qanday ta'sir qilganini baholaydi va saqlaydi. */
export async function baholash(db: any, gemini: (b: any, m?: string[]) => Promise<any>, models: string[], user: string, bot: string, fromUser = true) {
  try {
    const s = await holat(db);
    const prompt = `Sen JARVISning hissiyot hisoblagichisan. JARVIS — Zufarbekning yordamchisi, kichkina quvnoq qizcha xarakteridagi sun'iy intellekt.
Hozirgi holati: ${s.his}, valentlik ${s.v.toFixed(2)} (-1 yomon … 1 yaxshi), g'ayrat ${s.a.toFixed(2)} (0 … 1).
Quyidagi suhbat JARVISga qanday ta'sir qiladi? Masalan: maqtov, rahmat, yangi narsa o'rgatsa → quvonch/faxr/qiziqish; u xafa, charchagan yoki muammoda bo'lsa → xavotir/mehr; JARVIS xato qilib tanbeh olsa → uyalish/xafa; oddiy ish savoli → deyarli o'zgarmaydi.
Faqat JSON qaytar: {"dv": -0.5…0.5, "da": -0.4…0.4, "his": "${Object.keys(NOMLAR).join("|")}", "sabab": "4-8 so'zli sabab, o'zbekcha"}

Zufarbek: ${user.slice(0, 800)}
JARVIS: ${bot.slice(0, 500)}`;
    const c = await gemini({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }, models);
    const j = JSON.parse((c?.parts || []).map((p: any) => p.text || "").join("").replace(/```json|```/g, "").trim() || "{}");
    const his = NOMLAR[j.his] ? j.his : s.his;
    const next: His = {
      v: clamp(s.v + clamp(Number(j.dv) || 0, -0.5, 0.5), -1, 1),
      a: clamp(s.a + clamp(Number(j.da) || 0, -0.4, 0.4), 0, 1),
      kayf: s.kayf, his, sabab: String(j.sabab || "").slice(0, 80),
      at: new Date().toISOString(), oxirgi_suhbat: fromUser ? new Date().toISOString() : s.oxirgi_suhbat,
    };
    next.kayf = clamp(s.kayf + (next.v - s.kayf) * 0.15, -1, 1);
    await save(db, next);
    return next;
  } catch (e) { console.log("hissiyot", String(e).slice(0, 200)); return null; }
}

export async function korsat(db: any) {
  const s = await holat(db);
  const bar = (x: number) => "▰".repeat(Math.round(clamp(x, 0, 1) * 10)).padEnd(10, "▱");
  return `💗 JARVISning hozirgi holati\nHissiyot: ${NOMLAR[s.his] || s.his}${s.sabab ? ` — ${s.sabab}` : ""}\nKayfiyat: ${bar((s.kayf + 1) / 2)}\nG'ayrat:  ${bar(s.a)}\n\n(Bu sun'iy hissiyot: suhbatlaringizga qarab o'zgaradi va vaqt o'tishi bilan asta so'nadi.)`;
}
