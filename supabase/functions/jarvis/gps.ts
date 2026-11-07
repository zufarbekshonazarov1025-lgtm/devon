// deno-lint-ignore-file no-explicit-any
// JARVIS GPS (07.11.2026): telefondan joylashuvni qabul qilish, takrorlangan joylar haqida "Bu yer qayer?" deb so'rash,
// kunlik / haftalik / oylik yo'l hisobotlari va Zufarbekni tanish uchun o'zi boshlaydigan savollar.
// Tashriflarni SQL tomoni hisoblaydi: gps_qayta_ishla() (bir joyda 10+ daqiqa = tashrif), joylar jadvali — nomlangan va nomalum joylar.

const TZ = "Asia/Tashkent";
export type Deps = {
  db: any;
  tg: (m: string, b: Record<string, unknown>) => Promise<any>;
  gemini: (b: any, m?: string[]) => Promise<any>;
  setting: (k: string) => Promise<any>;
  ownerId: number;
};

const textOf = (c: any) => (c?.parts || []).map((p: any) => p.text || "").join("").trim();
export const hm = (iso: string | Date) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dm = (iso: string | Date) => new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const localHour = () => Number(new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }));
const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
export function dur(m: number) { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? `${h} soat${r ? " " + r + " daq" : ""}` : `${r} daq`; }
const mapUrl = (lat: number, lng: number) => `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
const WD = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const wdOf = (d: Date) => WD[new Date(d.toLocaleString("en-US", { timeZone: TZ })).getDay()];
/** Toshkent vaqti bo'yicha sana boshlanishi (YYYY-MM-DD → Date). */
const dayStart = (s: string) => new Date(`${s}T00:00:00+05:00`);

export const joyNomi = (j: any) => j?.nom || (j?.manzil ? `nomi noma'lum joy (${j.manzil})` : `nomi noma'lum joy #${j?.id ?? "?"}`);

/** Xaritadan taxminiy manzil (OpenStreetMap). Bo'lmasa "". */
export async function manzil(lat: number, lng: number) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=uz,ru`, { headers: { "User-Agent": "JARVIS-Uchqur/1.0 (shaxsiy yordamchi)" }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const a = j?.address || {};
    const parts = [j?.name && j.name !== a.road ? j.name : "", [a.road, a.house_number].filter(Boolean).join(" "), a.neighbourhood || a.suburb || a.quarter || "", a.city || a.town || a.village || a.county || ""].filter(Boolean);
    return [...new Set(parts)].join(", ").slice(0, 160);
  } catch { return ""; }
}

async function ensureManzil(d: Deps, j: any) {
  if (j.manzil) return j.manzil;
  const m = await manzil(j.lat, j.lng);
  if (m) { await d.db.from("joylar").update({ manzil: m }).eq("id", j.id); j.manzil = m; }
  return m;
}

// ---------- telefondan nuqtalar ----------
export async function saveLocations(d: Deps, body: any) {
  const pts = (Array.isArray(body?.points) ? body.points : []).slice(0, 3000)
    .filter((p: any) => Number.isFinite(+p?.lat) && Number.isFinite(+p?.lng) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lng) <= 180 && +p.t > 1.7e12)
    .map((p: any) => ({ t: new Date(+p.t).toISOString(), lat: +p.lat, lng: +p.lng, acc: p.acc == null ? null : +p.acc, speed: p.speed == null ? null : +p.speed, batt: p.batt == null ? null : Math.round(+p.batt) }));
  if (!pts.length) return { ok: true, n: 0 };
  const { error } = await d.db.from("gps_nuqtalar").upsert(pts, { onConflict: "t", ignoreDuplicates: true });
  return error ? { ok: false, error: error.message } : { ok: true, n: pts.length };
}

// ---------- vositalar uchun ----------
export async function hozirQayerda(d: Deps) {
  const { data: p } = await d.db.from("gps_nuqtalar").select("t,lat,lng,acc,batt").order("t", { ascending: false }).limit(1).maybeSingle();
  if (!p) return { xato: "Telefondan hali bitta ham joylashuv kelmagan. JARVIS ilovasida GPS yoqilganini tekshirish kerak." };
  const { data: v } = await d.db.from("tashriflar").select("boshlandi,tugadi,joy_id,haqiqiy").eq("yopiq", false).order("id", { ascending: false }).limit(1).maybeSingle();
  let joy: any = null;
  if (v?.joy_id) joy = (await d.db.from("joylar").select("*").eq("id", v.joy_id).maybeSingle()).data;
  if (!joy) {
    const { data: js } = await d.db.from("joylar").select("*").limit(500);
    joy = (js ?? []).map((j: any) => ({ ...j, d: dist(j.lat, j.lng, p.lat, p.lng) })).filter((j: any) => j.d <= Math.max(j.radius, 120)).sort((a: any, b: any) => a.d - b.d)[0] || null;
  }
  const yosh = Math.round((Date.now() - new Date(p.t).getTime()) / 60000);
  return {
    joy: joy ? joyNomi(joy) : "noma'lum joy",
    manzil: joy?.manzil || (await manzil(p.lat, p.lng)) || null,
    shu_yerda_beri: v?.haqiqiy ? `${hm(v.boshlandi)} dan beri (${dur(mins(v.boshlandi, p.t))})` : "yo'lda yoki endi keldi",
    oxirgi_malumot: yosh <= 2 ? "hozirgina" : `${yosh} daqiqa oldin (${hm(p.t)})`,
    aniqlik_m: p.acc, batareya: p.batt, xarita: mapUrl(p.lat, p.lng),
  };
}

function dist(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function visits(d: Deps, dan: Date, gacha: Date) {
  const { data } = await d.db.from("tashriflar").select("boshlandi,tugadi,joy_id,joylar(id,nom,manzil,holat)").eq("haqiqiy", true).lt("boshlandi", gacha.toISOString()).gt("tugadi", dan.toISOString()).order("boshlandi").limit(2000);
  return (data ?? []) as any[];
}

export async function yurganJoylar(d: Deps, sana: string, gacha?: string) {
  const dan = dayStart(sana), end = new Date(dayStart(gacha || sana).getTime() + 86400000);
  const [vs, { data: km }, { count }] = await Promise.all([
    visits(d, dan, end),
    d.db.rpc("gps_km", { dan: dan.toISOString(), gacha: end.toISOString() }),
    d.db.from("gps_nuqtalar").select("id", { count: "exact", head: true }).gte("t", dan.toISOString()).lt("t", end.toISOString()),
  ]);
  if (!count) return { natija: "Bu kunlar uchun GPS ma'lumoti yo'q (ilova o'chiq bo'lgan yoki hali yoqilmagan)." };
  return {
    joylar: vs.map((v) => ({ sana: dm(v.boshlandi), vaqt: `${hm(v.boshlandi)}–${hm(v.tugadi)}`, davomiylik: dur(mins(v.boshlandi, v.tugadi)), joy: joyNomi(v.joylar) })),
    yurilgan_km: Number(km ?? 0), gps_nuqtalar: count,
  };
}

export async function joyniNomla(d: Deps, a: any) {
  let id = Number(a.joy_id) || 0;
  if (!id) {
    const { data } = await d.db.from("joylar").select("id").eq("holat", "soralgan").order("soralgan_at", { ascending: false }).limit(1).maybeSingle();
    id = data?.id || 0;
  }
  if (!id) {
    const { data } = await d.db.from("tashriflar").select("joy_id").not("joy_id", "is", null).order("id", { ascending: false }).limit(1).maybeSingle();
    id = data?.joy_id || 0;
  }
  if (!id) return { xato: "qaysi joyni nomlash kerakligi topilmadi" };
  const nom = String(a.nom || "").trim().slice(0, 80);
  if (!nom) return { xato: "nom bo'sh" };
  const { data: j, error } = await d.db.from("joylar").update({ nom, izoh: a.izoh ?? null, holat: "nomlangan" }).eq("id", id).select("*").single();
  if (error) return { xato: error.message };
  await ensureManzil(d, j);
  await d.db.from("bilim").insert({ mavzu: "joy", matn: `Joy «${nom}»${a.izoh ? " — " + a.izoh : ""}${j.manzil ? " (" + j.manzil + ")" : ""}`, kimga: ["jarvis"], manba: "jarvis" });
  return { ok: true, joy_id: id, nom };
}

export async function joylarRoyxati(d: Deps) {
  const { data } = await d.db.from("joylar").select("id,nom,izoh,manzil,holat,tashrif_soni").order("tashrif_soni", { ascending: false }).limit(60);
  return (data ?? []).map((j: any) => ({ id: j.id, nom: joyNomi(j), izoh: j.izoh, holat: j.holat, tashriflar: j.tashrif_soni }));
}

/** think() tizim matni uchun: javob kutilayotgan joy savollari. */
export async function pendingText(d: Deps) {
  const { data } = await d.db.from("joylar").select("id,manzil,tashrif_soni,soralgan_at").eq("holat", "soralgan").order("soralgan_at", { ascending: false }).limit(5);
  if (!data?.length) return "";
  return "\nJAVOB KUTILAYOTGAN JOY SAVOLLARI (\"Bu yer qayer?\" deb so'ragansan):\n" + data.map((j: any) => `- joy #${j.id}${j.manzil ? " (" + j.manzil + ")" : ""}, ${j.tashrif_soni} marta borgan, so'ralgan: ${dm(j.soralgan_at)} ${hm(j.soralgan_at)}`).join("\n");
}

// ---------- har 5 daqiqada ----------
export async function tick(d: Deps, uslub: string) {
  const { data: n } = await d.db.rpc("gps_qayta_ishla");
  const cfg = (await d.setting("gps")) || {};
  const h = localHour();
  const res: any = { nuqtalar: n };
  if (cfg.paused) return res;
  if (h >= 8 || h < 1) res.joy = await askPlace(d, cfg);
  if (!res.joy && h >= 10 && h < 24) res.savol = await askLearning(d, cfg, uslub);
  return res;
}

async function askPlace(d: Deps, cfg: any) {
  const need = Number(cfg.sorash_soni || 2);
  const since = new Date(Date.now() - 40 * 60000).toISOString();
  const { count: recent } = await d.db.from("joylar").select("id", { count: "exact", head: true }).gte("soralgan_at", since);
  if (recent) return null;
  const today = dayStart(ymd(new Date())).toISOString();
  const { count: asked } = await d.db.from("joylar").select("id", { count: "exact", head: true }).gte("soralgan_at", today);
  if ((asked ?? 0) >= Number(cfg.kuniga_joy_savol || 8)) return null;
  const old = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: c } = await d.db.from("joylar").select("*").gte("tashrif_soni", need)
    .or(`holat.eq.nomalum,and(holat.eq.soralgan,soralgan_at.lt."${old}")`).order("tashrif_soni", { ascending: false }).limit(1);
  const j = c?.[0];
  if (!j) return null;
  // so'nggi tashriflar — u shu joyni eslashi oson bo'lsin
  const { data: vs } = await d.db.from("tashriflar").select("boshlandi,tugadi,yopiq").eq("joy_id", j.id).order("boshlandi", { ascending: false }).limit(3);
  const v = vs?.[0];
  if (v && Date.now() - new Date(v.tugadi).getTime() > 3 * 86400000 && j.holat === "soralgan") return null; // eski, qayta bezovta qilmaymiz
  const m = await ensureManzil(d, j);
  const now = v && !v.yopiq && Date.now() - new Date(v.tugadi).getTime() < 20 * 60000;
  const when = (vs ?? []).map((x: any) => `${dm(x.boshlandi)} ${hm(x.boshlandi)}–${hm(x.tugadi)}`).join("; ");
  const text = `📍 Zufarbek, siz bu joyda ${j.tashrif_soni} marta bo'ldingiz${now ? " — hozir ham shu yerdasiz" : ""}.\n🕘 ${when}${m ? `\n🗺 Taxminiy manzil: ${m}` : ""}\n\nBu yer qayer? Shu xabarga javob qilib yozing (masalan: uyim, ofis, onamning uyi, sport zal).`;
  await d.tg("sendLocation", { chat_id: d.ownerId, latitude: j.lat, longitude: j.lng, disable_notification: true });
  const r = await d.tg("sendMessage", { chat_id: d.ownerId, text, reply_markup: { force_reply: true, input_field_placeholder: "Bu yer qayer?" } });
  await d.db.from("joylar").update({ holat: "soralgan", soralgan_at: new Date().toISOString(), ask_msg_id: r?.result?.message_id ?? null }).eq("id", j.id);
  await d.db.from("jarvis_msgs").insert({ role: "bot", text: `[joy #${j.id} haqida so'radim] ${text}` });
  return { joy_id: j.id };
}

async function askLearning(d: Deps, cfg: any, uslub: string) {
  const perDay = Number(cfg.kuniga_savol ?? 3);
  if (perDay <= 0) return null;
  const st = cfg.savol || {};
  const today = ymd(new Date());
  const cnt = st.kun === today ? Number(st.soni || 0) : 0;
  if (cnt >= perDay) return null;
  if (st.at && Date.now() - new Date(st.at).getTime() < 3 * 3600000) return null;
  const { data: last } = await d.db.from("jarvis_msgs").select("created_at").order("id", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.created_at).getTime() < 2 * 3600000) return null; // suhbat endi bo'lgan — bezovta qilmaymiz
  const [{ data: mem }, { data: hist }, vs] = await Promise.all([
    d.db.from("bilim_jarvis").select("mavzu,matn").limit(300),
    d.db.from("jarvis_msgs").select("role,text").order("id", { ascending: false }).limit(30),
    visits(d, dayStart(today), new Date()),
  ]);
  const places = [...new Set(vs.filter((v) => v.joylar?.nom).map((v) => v.joylar.nom))];
  const prompt = `Sen JARVISsan — Zufarbekning shaxsiy yordamchisi. ${uslub}
Hozir sen o'zing suhbat boshlaysan: Zufarbekni yaxshiroq tanish uchun unga BITTA qisqa, tabiiy savol ber (1-2 gap, "siz" deb). U hamma savollarga javob berishga rozi.
- Bilim bazasida allaqachon bor narsani so'rama; oxirgi suhbatlarda bergan savollaringni takrorlama.
- Mavzular: kun tartibi va odatlari, ishi, qiziqishlari, yoqtirgan va yoqtirmagan narsalari, do'stlari, orzu-maqsadlari, qadriyatlari, bugungi kuni qanday o'tgani.
- Og'ir oilaviy yoki juda shaxsiy mavzularni o'zing ko'tarma. Maslahat berma — faqat so'ra.
${places.length ? `- Bugun u shu joylarda bo'ldi: ${places.join(", ")} — xohlasang shunga bog'lab so'ra.` : ""}
Faqat savolning o'zini yoz, o'zbek lotin yozuvida.

BILIM BAZASI:
${(mem ?? []).map((m: any) => `- [${m.mavzu}] ${m.matn}`).join("\n") || "(bo'sh)"}

OXIRGI SUHBAT:
${(hist ?? []).reverse().map((m: any) => `${m.role === "user" ? "Zufarbek" : "JARVIS"}: ${String(m.text).slice(0, 200)}`).join("\n")}`;
  let q = "";
  try { q = textOf(await d.gemini({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9 } })); } catch (e) { return { xato: String(e).slice(0, 120) }; }
  if (!q || q.length > 400) return null;
  await d.tg("sendMessage", { chat_id: d.ownerId, text: q });
  await d.db.from("jarvis_msgs").insert({ role: "bot", text: q });
  const cur = (await d.setting("gps")) || {};
  await d.db.from("app_settings").update({ value: { ...cur, savol: { kun: today, soni: cnt + 1, at: new Date().toISOString() } } }).eq("key", "gps");
  return { savol: q };
}

// ---------- hisobotlar ----------
export async function report(d: Deps, tur: string) {
  await d.db.rpc("gps_qayta_ishla");
  const now = new Date();
  const today = ymd(now);
  let dan: Date, gacha: Date, title: string;
  if (tur === "oy") {
    const [y, m] = today.split("-").map(Number);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    dan = dayStart(`${py}-${String(pm).padStart(2, "0")}-01`); gacha = dayStart(`${y}-${String(m).padStart(2, "0")}-01`);
    const OY = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
    title = `🗓 Oylik yo'l hisoboti — ${OY[pm - 1]} ${py}`;
  } else if (tur === "hafta") {
    gacha = new Date(dayStart(today).getTime() + 86400000); dan = new Date(gacha.getTime() - 7 * 86400000);
    title = `📅 Haftalik yo'l hisoboti — ${dm(dan)}–${dm(new Date(gacha.getTime() - 1))}`;
  } else {
    dan = dayStart(today); gacha = new Date(dan.getTime() + 86400000);
    title = `🗺 Kunlik yo'l hisoboti — ${today.split("-").reverse().join(".")} (${wdOf(now)})`;
  }
  const end = gacha < now ? gacha : now;
  const [vs, { data: km }, { count }] = await Promise.all([
    visits(d, dan, end),
    d.db.rpc("gps_km", { dan: dan.toISOString(), gacha: end.toISOString() }),
    d.db.from("gps_nuqtalar").select("id", { count: "exact", head: true }).gte("t", dan.toISOString()).lt("t", end.toISOString()),
  ]);
  if (!count) {
    const text = `${title}\n\n⚠️ Bu davrda telefondan GPS ma'lumoti kelmadi. JARVIS ilovasida «Joylashuvni yozish» yoqilganini tekshiring.`;
    await d.tg("sendMessage", { chat_id: d.ownerId, text });
    return { ok: true, text };
  }
  const clip = (v: any) => mins(new Date(Math.max(new Date(v.boshlandi).getTime(), dan.getTime())).toISOString(), new Date(Math.min(new Date(v.tugadi).getTime(), end.getTime())).toISOString());
  const unknown = new Set(vs.filter((v) => !v.joylar?.nom).map((v) => v.joy_id));
  let body = "";
  if (tur === "kun") {
    body = vs.map((v) => `• ${hm(v.boshlandi)}–${hm(v.tugadi)} — ${joyNomi(v.joylar)} (${dur(clip(v))})`).join("\n") || "Bir joyda 10 daqiqadan ko'p turilmagan.";
  } else {
    const g = new Map<string, { nom: string; m: number; days: Set<string>; n: number }>();
    for (const v of vs) {
      const k = String(v.joy_id ?? "?");
      const x = g.get(k) || { nom: joyNomi(v.joylar), m: 0, days: new Set(), n: 0 };
      x.m += clip(v); x.n++; x.days.add(ymd(new Date(v.boshlandi))); g.set(k, x);
    }
    const top = [...g.values()].sort((a, b) => b.m - a.m).slice(0, tur === "oy" ? 15 : 10);
    body = top.map((x, i) => `${i + 1}. ${x.nom} — ${x.days.size} kun, ${x.n} marta, jami ${dur(x.m)}`).join("\n") || "Tashriflar yo'q.";
    const { count: yangi } = await d.db.from("joylar").select("id", { count: "exact", head: true }).gte("yaratilgan", dan.toISOString()).lt("yaratilgan", end.toISOString());
    const dayKeys = new Set(vs.map((v) => ymd(new Date(v.boshlandi))));
    body += `\n\n📆 GPS bor kunlar: ${dayKeys.size}\n🆕 Yangi joylar: ${yangi ?? 0}`;
  }
  const text = `${title}\n\n${body}\n\n🚶 Yurilgan masofa: ${Number(km ?? 0)} km${unknown.size ? `\n❓ Nomi noma'lum joylar: ${unknown.size} ta — takrorlansa so'rayman.` : ""}`;
  await d.tg("sendMessage", { chat_id: d.ownerId, text });
  await d.db.from("jarvis_msgs").insert({ role: "bot", text: `[${tur} yo'l hisobotini yubordim] ${text.slice(0, 600)}` });
  return { ok: true, text };
}
