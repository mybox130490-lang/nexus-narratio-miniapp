/**
 * Тонкий вызов Anthropic Messages API. Единственный Deno-специфичный кусок
 * генератора кроме index.ts — использует Deno.env и fetch, не тестируется
 * юнитами в этом репозитории (см. README функции: почему).
 */

export interface AnthropicCallOptions {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export interface AnthropicCallResult {
  text: string;
}

export async function callAnthropic(opts: AnthropicCallOptions): Promise<AnthropicCallResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY не задан в окружении функции');

  const model = opts.model ?? Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<не удалось прочитать тело ответа>');
    throw new Error(`Anthropic API вернул ${res.status}: ${body}`);
  }

  const data = await res.json();
  const block = data?.content?.[0];
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('Anthropic API вернул ответ без текстового блока');
  }
  return { text: block.text };
}
