/**
 * Проверка initData Telegram Mini App.
 * Алгоритм из официальной документации Telegram: data-check-string —
 * все поля кроме hash, отсортированные по ключу и склеенные "key=value"
 * через \n; секрет — HMAC-SHA256(bot_token) с ключом "WebAppData";
 * итоговый хэш — HMAC-SHA256(data-check-string) с этим секретом.
 *
 * Используется только Web Crypto (globalThis.crypto.subtle) — это даёт
 * один и тот же код в Deno (Supabase Edge Functions) и в Node (тесты).
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
}

async function hmacSha256(keyBytes: BufferSource, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Постоянного времени сравнение хэшей — не через === на строке напрямую. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyOptions {
  /** Максимальный возраст initData в секундах. Против повторного использования. */
  maxAgeSeconds?: number;
}

/**
 * Проверяет initData и возвращает данные пользователя, если подпись верна.
 * Бросает Error с понятным сообщением при любой проблеме — вызывающий код
 * не должен пытаться угадывать причину по типу исключения.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  opts: VerifyOptions = {},
): Promise<VerifiedInitData> {
  if (!initData) throw new Error('initData пуст');
  if (!botToken) throw new Error('токен бота не задан');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('initData без hash');
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const computed = await hmacSha256(secretKey, dataCheckString);
  const computedHex = toHex(computed);

  if (!timingSafeEqualHex(computedHex, hash.toLowerCase())) {
    throw new Error('подпись initData не совпадает');
  }

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) throw new Error('initData без auth_date');

  const maxAge = opts.maxAgeSeconds ?? 24 * 60 * 60;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAge) throw new Error('initData устарел');
  if (ageSeconds < -60) throw new Error('initData из будущего — часы клиента разъехались с сервером');

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('initData без данных пользователя');

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error('initData: поле user не парсится как JSON');
  }
  if (typeof user.id !== 'number') throw new Error('initData: у пользователя нет числового id');

  return { user, authDate };
}
