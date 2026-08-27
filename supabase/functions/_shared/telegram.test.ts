import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyInitData } from './telegram.ts';

const BOT_TOKEN = 'test-bot-token-123';

async function hmac(keyBytes: BufferSource, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Собирает валидный initData тем же алгоритмом, что и клиент Telegram. */
async function buildInitData(fields: Record<string, string>, botToken = BOT_TOKEN): Promise<string> {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const hash = toHex(await hmac(secretKey, dataCheckString));
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

test('принимает корректно подписанный initData', async () => {
  const fields = {
    auth_date: String(nowSeconds()),
    query_id: 'AAABBB',
    user: JSON.stringify({ id: 777, first_name: 'Кто-то' }),
  };
  const initData = await buildInitData(fields);
  const result = await verifyInitData(initData, BOT_TOKEN);
  assert.equal(result.user.id, 777);
});

test('отклоняет подделанный hash', async () => {
  const fields = { auth_date: String(nowSeconds()), user: JSON.stringify({ id: 1 }) };
  const initData = await buildInitData(fields);
  const tampered = initData.replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
  await assert.rejects(() => verifyInitData(tampered, BOT_TOKEN), /подпись/);
});

test('отклоняет подпись, сделанную с другим токеном бота', async () => {
  const fields = { auth_date: String(nowSeconds()), user: JSON.stringify({ id: 1 }) };
  const initData = await buildInitData(fields, 'другой-токен');
  await assert.rejects(() => verifyInitData(initData, BOT_TOKEN), /подпись/);
});

test('отклоняет устаревший initData', async () => {
  const oldDate = nowSeconds() - 25 * 60 * 60; // 25 часов назад
  const fields = { auth_date: String(oldDate), user: JSON.stringify({ id: 1 }) };
  const initData = await buildInitData(fields);
  await assert.rejects(() => verifyInitData(initData, BOT_TOKEN), /устарел/);
});

test('отклоняет initData без hash', async () => {
  const params = new URLSearchParams({ auth_date: String(nowSeconds()), user: JSON.stringify({ id: 1 }) });
  await assert.rejects(() => verifyInitData(params.toString(), BOT_TOKEN), /hash/);
});

test('отклоняет initData без числового id пользователя', async () => {
  const fields = { auth_date: String(nowSeconds()), user: JSON.stringify({ id: 'не число' }) };
  const initData = await buildInitData(fields);
  await assert.rejects(() => verifyInitData(initData, BOT_TOKEN), /id/);
});

test('уважает опцию maxAgeSeconds', async () => {
  const fields = { auth_date: String(nowSeconds() - 120), user: JSON.stringify({ id: 1 }) };
  const initData = await buildInitData(fields);
  await assert.rejects(() => verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 60 }), /устарел/);
  const ok = await verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 300 });
  assert.equal(ok.user.id, 1);
});
