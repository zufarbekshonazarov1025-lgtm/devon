// deno-lint-ignore-file no-explicit-any
// JARVIS avtomatik xotirasi (07.11.2026). G'oya ochiq kodli yordamchilardan (Mr.Stack, claude-telegram-relay, Rook):
// har 3 soatda suhbatlarni qayta o'qib, Zufarbek O'ZI aytgan doimiy faktlarni bilim bazasiga yozadi —
// JARVIS suhbat paytida eslab_qol'ni unutib qo'ysa ham, bilim yo'qolmaydi.

const KEY = "jarvis_xotira";

export async function yigish(db: any, gemini: (b: any, m?: string[]) => Promise<any>) {
  const { data: st } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const last = Number(st?.value?.last_id || 0);
  const { data: msgs } = await db.from("jarvis_msgs").select("id,role,text").gt("id", last).order("id").limit(160);
  if (!msgs?.length) return { yangi: 0 };
  const maxId = msgs[msgs.length - 1].id;
  const saveLast = () => db.from("app_settings").upsert({ key: KEY, value: { ...(st?.value || {}), last_id: maxId, at: new Date().toISOString() } }, { onConflict: "key" });
  if (!msgs.some((m: any) => m.role === "user")) { await saveLast(); return { yangi: 0 }; }
  const { data: mem } = await db.from("bilim").select("mavzu,matn").eq("faol", true).limit(500);
  const prompt = `Quyida Zufarbek va uning yordamchisi JARVIS suhbati. Undan Zufarbek O'ZI aytgan yoki aniq tasdiqlagan DOIMIY faktlarni ajratib ol: odatlari, kun tartibi, ishi, qiziqishlari, yoqtirgan va yoqtirmagan narsalari, yaqinlari va tanishlari, joylar, qadriyatlari, rejalari, sheva so'zlarining ma'nosi, JARVISga bergan qoidalari.
QOIDALAR:
- Faqat Zufarbek aytganini ol. JARVIS gapi yoki taxmin — fakt emas.
- Bilim bazasida allaqachon bor narsani qaytarma (boshqacha so'z bilan ham).
- Bir martalik holatlarni ("bugun charchadim", "hozir yo'ldaman") olma.
- Parol, karta, hujjat raqamlarini hech qachon olma.
- Har fakt qisqa va aniq bo'lsin, o'zbek lotin yozuvida. Sheva so'zi bo'lsa: "so'z = ma'nosi".
Faqat JSON qaytar: [{"mavzu": "profil|ish|oila|dost|qiziqish|qadriyat|uslub|qoida|joy|odat|reja", "matn": "..."}] — ko'pi bilan 8 ta; yangi narsa bo'lmasa [].

BILIM BAZASI (bor narsalar):
${(mem ?? []).map((m: any) => `- [${m.mavzu}] ${m.matn}`).join("\n") || "(bo'sh)"}

SUHBAT:
${msgs.map((m: any) => `${m.role === "user" ? "Zufarbek" : "JARVIS"}: ${String(m.text).slice(0, 600)}`).join("\n")}`;
  let list: any[] = [];
  try {
    const c = await gemini({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } });
    const raw = (c?.parts || []).map((p: any) => p.text || "").join("").replace(/```json|```/g, "").trim();
    list = JSON.parse(raw || "[]");
  } catch (e) { return { xato: String(e).slice(0, 200) }; }
  const rows = (Array.isArray(list) ? list : []).slice(0, 8)
    .filter((f: any) => f?.matn && String(f.matn).length >= 4 && !/\b\d{12,19}\b/.test(String(f.matn)))
    .map((f: any) => ({ mavzu: String(f.mavzu || "umumiy").slice(0, 30), matn: String(f.matn).slice(0, 400), kimga: ["jarvis"], manba: "jarvis-xotira" }));
  if (rows.length) {
    const { error } = await db.from("bilim").insert(rows);
    if (error) return { xato: error.message };
  }
  await saveLast();
  return { yangi: rows.length, faktlar: rows.map((r: any) => r.matn) };
}
