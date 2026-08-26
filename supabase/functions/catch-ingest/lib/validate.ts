/**
 * Валидация входа — до похода в базу. Дублирует ограничения из
 * supabase/migrations/0001_init.sql (catches_*), но с понятными
 * сообщениями: 400 с человеческим текстом лучше, чем проброшенная
 * ошибка constraint от Postgres.
 */

import type { CatchKind } from './context.ts';

const VALID_KINDS: readonly CatchKind[] = ['image', 'return', 'repeat', 'avert', 'dream', 'scene'];
const VALID_INPUTS = ['text', 'voice', 'photo'] as const;
type InputKind = (typeof VALID_INPUTS)[number];

export interface IngestPayload {
  kind: CatchKind;
  raw_text: string;
  input: InputKind;
  audio_retained?: boolean;
  tz_offset_minutes?: number;
  context?: {
    place_type?: string;
    in_transit?: boolean;
    preceded_by?: string;
    with_people?: boolean;
  };
}

export class ValidationError extends Error {}

export function parseIngestPayload(body: unknown): IngestPayload {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('тело запроса должно быть объектом');
  }
  const b = body as Record<string, unknown>;

  if (typeof b.kind !== 'string' || !VALID_KINDS.includes(b.kind as CatchKind)) {
    throw new ValidationError(`kind должен быть одним из: ${VALID_KINDS.join(', ')}`);
  }
  const kind = b.kind as CatchKind;

  if (typeof b.raw_text !== 'string' || b.raw_text.trim().length === 0) {
    throw new ValidationError('raw_text не может быть пустым');
  }
  if (b.raw_text.length > 4000) {
    throw new ValidationError('raw_text длиннее 4000 символов — это уже не тридцать секунд');
  }

  const input = (typeof b.input === 'string' ? b.input : 'text') as InputKind;
  if (!VALID_INPUTS.includes(input)) {
    throw new ValidationError(`input должен быть одним из: ${VALID_INPUTS.join(', ')}`);
  }

  const audioRetained = Boolean(b.audio_retained);
  if (audioRetained && input !== 'voice') {
    throw new ValidationError('audio_retained допустим только при input="voice"');
  }

  if (kind === 'dream' && b.context && Object.keys(b.context as object).length > 0) {
    throw new ValidationError('у ночного сна не может быть контекста момента (ENGINE 6.1)');
  }

  const tzOffsetMinutes = typeof b.tz_offset_minutes === 'number' ? b.tz_offset_minutes : 0;
  if (Math.abs(tzOffsetMinutes) > 14 * 60) {
    throw new ValidationError('tz_offset_minutes вне разумного диапазона часовых поясов');
  }

  return {
    kind,
    raw_text: b.raw_text.trim(),
    input,
    audio_retained: audioRetained,
    tz_offset_minutes: tzOffsetMinutes,
    context: (b.context as IngestPayload['context']) ?? undefined,
  };
}
