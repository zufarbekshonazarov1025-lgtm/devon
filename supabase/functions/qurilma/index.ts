// Devon: telefon (qurilma) uchun. Ilova yopiq turganda ham bildirishnoma, vidjet va eslatma budilniklari ma'lumotini beradi.
// Qurilma o'z kaliti bilan tanitiladi; kalitning faqat izi (SHA-256) bazada saqlanadi. Admin qurilmani uzib qo'yishi mumkin.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

// Hamma sana hisobi Toshkent vaqtida (UTC+5)
const TZ = 5 * 3600 * 1000;
const OY = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const HAFTA = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
const local = (ms: number) => new Date(ms + TZ);
const isoDay = (ms: number) => local(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(d + "T00:00:00Z");
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * 86400000).toISOString().slice(0, 10);
const wd = (d: string) => ((new Date(dayMs(d)).getUTCDay() + 6) % 7) + 1; // 1 = dushanba
const dom = (d: string) => Number(d.slice(8, 10));
const lastDom = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
const hm = (ms: number) => local(ms).toISOString().slice(11, 16);
const atMs = (d: string, t: string) => Date.parse(`${d}T${t}:00Z`) - TZ; // Toshkent vaqtidagi kun+soat → haqiqiy vaqt

type Row = Record<string, any>;
function eventOn(e: Row, d: string) {
  const s = isoDay(Date.parse(e.starts_at));
  if (s === d) return true;
  if (d < s) return false;
  if (e.repeat === "haftalik") return wd(s) === wd(d);
  if (e.repeat === "oylik") return dom(s) === dom(d);
  return false;
}
function reminderOn(r: Row, d: string) {
  if (r.repeat === "kunlik") return true;
  if (r.repeat === "haftalik") return r.weekday === wd(d);
  if (r.repeat === "oylik") return r.monthday === dom(d);
  return r.remind_at ? isoDay(Date.parse(r.remind_at)) === d : false;
}
/** Eslatmaning hozirdan keyingi eng yaqin vaqti: [kun, soat:daqiqa] yoki null (o'tib ketgan bir martalik). */
function nextOf(r: Row, today: string, nowHm: string): [string, string] | null {
  if (r.repeat === "yoq") {
    if (!r.remind_at) return null;
    const ms = Date.parse(r.remind_at), d = isoDay(ms), t = hm(ms);
    return d > today || (d === today && t >= nowHm) ? [d, t] : null;
  }
  const t = String(r.at_time ?? "09:00").slice(0, 5);
  for (let i = 0; i < 62; i++) {
    const d = addDays(today, i);
    if (reminderOn(r, d) && (i > 0 || t >= nowHm)) return [d, t];
  }
  return null;
}
function whenLabel(d: string, t: string, today: string) {
  const diff = Math.round((dayMs(d) - dayMs(today)) / 86400000);
  const day = diff === 0 ? "Bugun" : diff === 1 ? "Ertaga" : diff < 7 ? HAFTA[wd(d) - 1] : `${dom(d)}-${OY[Number(d.slice(5, 7)) - 1]}`;
  return `${day} ${t}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return out({ error: "method" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* bo'sh */ }
  const key = String(body.key ?? "");
  if (key.length < 32) return out({ error: "kalit" }, 401);
  const { data: dev } = await admin.from("devices").select("id,user_id,revoked,last_seen,last_notif_id").eq("key_hash", await sha(key)).maybeSingle();
  if (!dev || dev.revoked) return out({ error: "uzilgan" }, 401);
  const uid = dev.user_id as string;
  const { data: profs } = await admin.from("profiles").select("id,short_name,full_name,kind");
  const me = (profs ?? []).find((p) => p.id === uid);
  if (!me) return out({ error: "uzilgan" }, 401);
  const owner = (profs ?? []).find((p) => p.kind === "yordamchi") ?? me;
  const first = (id: string) => String((profs ?? []).find((p) => p.id === id)?.full_name ?? "").split(" ")[0];
  const now = Date.now(), date = isoDay(now), nowHm = hm(now);

  // Reja bandini vidjetdan belgilash: dasturdagi qoida bilan bir xil (o'z bandini yoki reja egasi hammasini)
  if (body.action === "toggle") {
    const { data: it } = await admin.from("plan_items").select("id,owner_id,for_id,done,is_private").eq("id", String(body.item_id ?? "")).maybeSingle();
    if (it && (!it.is_private || it.owner_id === uid) && ((it.for_id ?? it.owner_id) === uid || it.owner_id === uid)) {
      await admin.from("plan_items").update({ done: !it.done, done_at: !it.done ? new Date().toISOString() : null }).eq("id", it.id);
    }
  }

  // Yangi bildirishnomalar: har qurilma o'zi ko'rgan oxirgi raqamni eslab qoladi
  let notifs: Row[] = [];
  let last = Number(dev.last_notif_id ?? 0);
  if (!dev.last_seen) {
    const { data: mx } = await admin.from("notifications").select("id").eq("user_id", uid).order("id", { ascending: false }).limit(1);
    last = Number(mx?.[0]?.id ?? 0);
  } else {
    const { data: n } = await admin.from("notifications").select("id,title,body,ref_type,ref_id").eq("user_id", uid).is("read_at", null).gt("id", last).order("id").limit(20);
    notifs = n ?? [];
    if (notifs.length) last = Number(notifs[notifs.length - 1].id);
  }
  await admin.from("devices").update({ last_seen: new Date().toISOString(), last_notif_id: last }).eq("id", dev.id);

  const [planQ, tasksQ, evQ, remQ, recQ, setQ, ackQ] = await Promise.all([
    admin.from("plan_items").select("id,title,at_time,done,owner_id,for_id,is_private,sort,created_at").eq("owner_id", owner.id).eq("plan_date", date),
    admin.from("tasks").select("id,seq,title,due_date,status,assignee_id,creator_id,is_private").is("deleted_at", null).not("status", "in", "(bajarildi,bekor)").order("due_date").limit(200),
    admin.from("events").select("id,title,owner_id,created_by,starts_at,all_day,repeat,is_private"),
    admin.from("reminders").select("id,title,owner_id,for_id,repeat,remind_at,at_time,weekday,monthday,for_both,active,is_private,created_at").eq("active", true),
    admin.from("recurrences").select("id,next_run,active,is_private,creator_id,assignee_id").eq("active", true),
    admin.from("app_settings").select("value").eq("key", "muhimlik").maybeSingle(),
    admin.from("reminder_acks").select("reminder_id,occ_date").gte("occ_date", addDays(date, -2)),
  ]);

  const plan = (planQ.data ?? []).filter((i) => !i.is_private || i.owner_id === uid)
    .sort((a, b) => String(a.at_time ?? "99").localeCompare(String(b.at_time ?? "99")) || Number(a.sort ?? 0) - Number(b.sort ?? 0) || String(a.created_at).localeCompare(String(b.created_at)))
    .map((i) => ({ id: i.id, title: i.title, time: String(i.at_time ?? "").slice(0, 5), done: !!i.done, who: (i.for_id ?? i.owner_id) === uid ? "" : first(i.for_id ?? i.owner_id), mine: (i.for_id ?? i.owner_id) === uid || i.owner_id === uid }));

  const lim = (setQ.data?.value ?? {}) as Row, muhimKun = Number(lim.muhim_kun ?? 3), ortaKun = Number(lim.ortacha_kun ?? 10);
  const openTasks = (tasksQ.data ?? []).filter((t) => !t.is_private || t.assignee_id === uid || t.creator_id === uid);
  const tasks = openTasks.map((t) => {
    const left = Math.round((dayMs(t.due_date) - dayMs(date)) / 86400000);
    return { id: t.id, seq: t.seq, title: t.title, due: t.due_date, status: t.status, who: t.assignee_id === uid ? "" : first(t.assignee_id),
      pri: left <= muhimKun ? "Muhim!" : left <= ortaKun ? "O'rtacha" : "Muhim emas", lvl: left <= muhimKun ? 2 : left <= ortaKun ? 1 : 0,
      left: left < 0 ? `Kechikdi · ${-left} kun` : left === 0 ? "Bugun" : left === 1 ? "Ertaga" : `${left} kun qoldi` };
  });

  const events = (evQ.data ?? []).filter((e) => !e.is_private || e.owner_id === uid || e.created_by === uid);
  // Menga tegishli eslatmalar: o'zimga qo'yganim, menga qo'yilgani yoki ikkalamizga
  const rems = (remQ.data ?? []).filter((r) => (r.for_both || (r.for_id ? r.for_id === uid : r.owner_id === uid)) && (!r.is_private || r.owner_id === uid));
  const recs = (recQ.data ?? []).filter((r) => !r.is_private || r.creator_id === uid || r.assignee_id === uid);
  const REP: Row = { kunlik: "har kuni", haftalik: "har hafta", oylik: "har oy" };
  const reminders = rems.map((r) => ({ r, n: nextOf(r, date, nowHm) })).filter((x) => x.n)
    .sort((a, b) => (a.n![0] + a.n![1]).localeCompare(b.n![0] + b.n![1])).slice(0, 30)
    .map((x) => ({ id: x.r.id, title: x.r.title, when: whenLabel(x.n![0], x.n![1], date), today: x.n![0] === date, time: x.n![1], repeat: REP[x.r.repeat] ?? "", both: !!x.r.for_both }));

  // Eslatma budilniklari: telefon o'zi chaladi (15 daqiqa oldin, vaqtida, 30 daqiqa o'tib qabul qilinmasa).
  // Qabul qilinganlari kirmaydi; oxirgi 40 daqiqadan keyingi 2 kunlik vaqtlar.
  const acked = new Set((ackQ.data ?? []).map((a) => a.reminder_id + "|" + a.occ_date));
  const alarms: Row[] = [];
  for (const r of rems) {
    const created = Date.parse(r.created_at);
    for (let i = -1; i <= 2; i++) {
      const d = addDays(date, i);
      if (!reminderOn(r, d) || acked.has(r.id + "|" + d)) continue;
      const at = r.repeat === "yoq" ? Date.parse(r.remind_at) : atMs(d, String(r.at_time ?? "09:00").slice(0, 5));
      if (at < now - 40 * 60000 || at > now + 2 * 86400000 || at < created) continue;
      alarms.push({ key: r.id + "|" + d, title: r.title, at, time: hm(at), by: r.for_id && r.for_id === uid && r.owner_id !== uid ? first(r.owner_id) : "" });
    }
  }

  // Oy taqvimi: har kun uchun belgilar (m = muddat, u = uchrashuv, e = eslatma, t = takroriy topshiriq)
  const ym = date.slice(0, 8), n = lastDom(date), days: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = ym + String(i).padStart(2, "0");
    days.push((openTasks.some((t) => t.due_date === d) ? "m" : "") + (events.some((e) => eventOn(e, d)) ? "u" : "") + (rems.some((r) => reminderOn(r, d)) ? "e" : "") + (recs.some((r) => r.next_run === d) ? "t" : ""));
  }
  const tm = openTasks.filter((t) => t.due_date === date).length, tu = events.filter((e) => eventOn(e, date)).length, te = rems.filter((r) => reminderOn(r, date)).length;
  const sum = [tm && `${tm} muddat`, tu && `${tu} uchrashuv`, te && `${te} eslatma`].filter(Boolean).join(", ");
  const mo = OY[Number(date.slice(5, 7)) - 1];
  // ym: vidjetda kun bosilganda dastur aynan shu sanani ochishi uchun (YYYY-MM)
  const month = { label: mo.charAt(0).toUpperCase() + mo.slice(1) + " " + date.slice(0, 4), ym: date.slice(0, 7), first: wd(ym + "01"), today: dom(date), days, sum: sum ? "Bugun: " + sum : "Bugun bo'sh" };

  return out({ date, name: me.short_name, notifications: notifs, plan, tasks, reminders, alarms, month });
});
