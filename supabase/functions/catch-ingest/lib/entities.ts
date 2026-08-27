/**
 * Разбор записи на сущности (ENGINE 6.1: images / feelings / actions / valence).
 *
 * ЧЕСТНО ПРО ГРАНИЦЫ ЭТОГО МОДУЛЯ: полноценное извлечение образов и
 * действий из свободного текста — задача для модели, не для регулярок.
 * Подделывать её эвристикой значит закладывать в анализ и профиль
 * фиктивные данные — а вся защита от апофении в pattern-analytics стоит
 * именно на том, что данные настоящие. Поэтому здесь извлекается только
 * то, что регулярка извлекает надёжно (валентность и чувства по словарю),
 * а `images`/`actions` остаются пустыми до подключения модели.
 *
 * Швов для замены — один: extractEntities. Сигнатура не меняется, когда
 * внутри появится вызов модели вместо словаря.
 */

export type Valence = 'negative' | 'neutral' | 'resource';

export interface ExtractedEntities {
  images: string[];
  feelings: string[];
  actions: string[];
  valence: Valence;
  /** Метка версии извлечения — чтобы будущий переход на модель был виден в данных. */
  extraction_method: 'heuristic_v0';
}

// Словари намеренно небольшие: лучше вернуть меньше чувств, но верных,
// чем угадывать. Ключ — форма для поиска, значение — как показывать.
const FEELING_LEXICON: Record<string, string> = {
  'насторож': 'настороженность',
  'тревог': 'тревога',
  'страх': 'страх',
  'испуг': 'испуг',
  'раздраж': 'раздражение',
  'зл': 'злость',
  'груст': 'грусть',
  'печал': 'печаль',
  'одиноч': 'одиночество',
  'стыд': 'стыд',
  'вин': 'вина',
  'растеря': 'растерянность',
  'удивл': 'удивление',
  'любопыт': 'любопытство',
  'интерес': 'интерес',
  'радост': 'радость',
  'тепл': 'тепло',
  'спокой': 'спокойствие',
  'облегч': 'облегчение',
  'благодар': 'благодарность',
  'нежност': 'нежность',
  'восхищ': 'восхищение',
  'вдохнов': 'вдохновение',
};

const RESOURCE_MARKERS = ['радост', 'тепл', 'спокой', 'облегч', 'благодар', 'нежност', 'восхищ', 'вдохнов', 'интерес', 'любопыт'];
const NEGATIVE_MARKERS = ['тревог', 'страх', 'испуг', 'раздраж', 'зл', 'груст', 'печал', 'одиноч', 'стыд', 'вин', 'ненавист', 'отчаян'];

function findFeelings(lowerText: string): string[] {
  const found = new Set<string>();
  for (const [stem, label] of Object.entries(FEELING_LEXICON)) {
    if (lowerText.includes(stem)) found.add(label);
  }
  return Array.from(found);
}

function scoreValence(lowerText: string): Valence {
  let resourceHits = 0;
  let negativeHits = 0;
  for (const m of RESOURCE_MARKERS) if (lowerText.includes(m)) resourceHits++;
  for (const m of NEGATIVE_MARKERS) if (lowerText.includes(m)) negativeHits++;
  if (resourceHits === 0 && negativeHits === 0) return 'neutral';
  return resourceHits >= negativeHits ? 'resource' : 'negative';
}

export function extractEntities(rawText: string): ExtractedEntities {
  const lower = rawText.toLowerCase();
  return {
    images: [],
    actions: [],
    feelings: findFeelings(lower),
    valence: scoreValence(lower),
    extraction_method: 'heuristic_v0',
  };
}
