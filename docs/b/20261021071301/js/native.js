import { sb, S, toast } from './core.js';

/** Android ilovasi ichidamizmi (qobiq sahifaga DevonNative obyektini beradi). */
export const inApp = () => typeof window.DevonNative === 'object' && typeof window.DevonNative.deviceKey === 'function';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Telefonni qurilma sifatida ro'yxatdan o'tkazadi: fonda bildirishnoma va vidjet shu orqali ishlaydi. */
export async function registerDevice() {
  if (!inApp() || !S.me) return;
  try {
    const hash = await sha256(window.DevonNative.deviceKey());
    const { data } = await sb.from('devices').select('id,revoked,user_id').eq('key_hash', hash);
    const mine = (data || [])[0];
    if (mine && !mine.revoked && mine.user_id === S.me.id) { window.DevonNative.registered(); return; }
    if (mine) { // uzilgan yoki boshqa hisobniki: yangi kalit bilan qaytadan
      window.DevonNative.signedOut();
      return registerDevice.again ? null : ((registerDevice.again = true), registerDevice());
    }
    const { error } = await sb.from('devices').insert({ user_id: S.me.id, key_hash: hash, name: window.DevonNative.deviceName(), platform: 'android' });
    if (error) { if (!registerDevice.again) { registerDevice.again = true; window.DevonNative.signedOut(); return registerDevice(); } return; }
    window.DevonNative.registered();
    toast('Bu telefon bildirishnoma va vidjet uchun ulandi');
  } catch (e) { /* keyingi ochilishda yana urinadi */ }
}

/** Hisobdan chiqishda: qurilmani uzamiz va telefondagi ma'lumotni tozalaymiz. */
export async function unregisterDevice() {
  if (!inApp()) return;
  try {
    const hash = await sha256(window.DevonNative.deviceKey());
    await sb.from('devices').update({ revoked: true }).eq('key_hash', hash);
  } catch (e) { /* aloqa bo'lmasa ham davom etamiz */ }
  try { window.DevonNative.signedOut(); } catch (e) { /* eski qobiq */ }
}

/** Ma'lumot o'zgarganda vidjet tezroq yangilansin. */
export function nudge() { if (inApp()) { try { window.DevonNative.sync(); } catch (e) { /* eski qobiq */ } } }
