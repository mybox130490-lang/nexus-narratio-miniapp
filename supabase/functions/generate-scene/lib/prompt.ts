/**
 * Сборка промпта для генератора сцен. Правило контекста (ENGINE §7.2):
 * модель получает дистиллят + активные паттерны + свёртки нужного периода
 * + ОДНУ сырую запись-семя. Сырая история целиком не передаётся никогда —
 * этот файл физически не принимает ничего похожего на список записей.
 */

import type { AxisName } from './contract.ts';

export type SourceKind = 'image' | 'return' | 'repeat' | 'avert' | 'dream' | 'scene';

export interface DistillateSymbol { symbol: string; meaning: string }
export interface DistillateFigure { name: string; archetype: string }

export interface SeedDossier {
  /** Единственная сырая запись, вокруг которой строится история (ENGINE §7.2). */
  sourceCatchText: string;
  sourceKind: SourceKind;
  distillateSymbols: DistillateSymbol[];
  distillateFigures: DistillateFigure[];
  /** Короткие наблюдения из pattern-analytics, уже посчитанные, без сырых данных. */
  activePatterns: string[];
  rollupSummary?: string;
  /** Темы из джйотиш (ENGINE §3) или их дневниковый эквивалент без даты рождения (CONCEPT §11). */
  chartThemes: string[];
  /** Тумблер «показать механику» (CONCEPT §11). По умолчанию выключен. */
  showMechanics: boolean;
  /** Оси с малым n в профиле выбора — генератор должен намеренно их задеть (ENGINE §8.3). */
  underObservedAxes: AxisName[];
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

const REPEAT_KIND_NOTE =
  'Исходная запись — повтор (kind=repeat, класс «синхроний»). Она трактуется ИСКЛЮЧИТЕЛЬНО как ' +
  'настройка личного фильтра восприятия. Ни в тексте, ни в репликах героев не должно звучать, что ' +
  'повторение — знак, послание или совпадение неслучайно.';

function systemPrompt(showMechanics: boolean): string {
  const mechanicsLine = showMechanics
    ? 'Тумблер «показать механику» включён: можно называть темы карты (дома, дашу) прямым текстом, если это уместно художественно.'
    : 'Тумблер «показать механику» выключен (это значение по умолчанию): темы карты используются только как скрытый ' +
      'генератор конфликта. Планеты, дома, даша/антардаша, лагна — не называются пользователю ни в одном слове текста.';

  return [
    'Ты — Драматург в Турии. Ты превращаешь одну зацепку внимания пользователя в интерактивную историю.',
    'История — не развлечение и не предсказание: это симуляция, в которой каждый выбор размечен по осям ' +
      'поведения и позже сравнивается с тем, что человек пишет о себе в дневнике.',
    '',
    'Жёсткие правила формы (ENGINE.md §8):',
    '— История: 5–7 сцен. Каждая сцена: 400–700 слов. Больше не дочитывают с телефона.',
    '— В каждой сцене, кроме последней: 2–4 развилки. У КАЖДОГО варианта обязательно поле cost — цена ' +
      'выбора. Вариант без цены не развилка, а декорация, и будет отклонён.',
    '— Развилка — конфликт ценностей: оба варианта должны чем-то жертвовать, ни один не должен быть ' +
      'очевидно лучше другого.',
    '— У каждого варианта — 1–2 отметки axes (ось, полюс A/B, вес 0.5 или 1.0). Больше двух — разметка ' +
      'размывается и будет отклонена.',
    '— Последняя сцена: ровно 0 развилок, anchor_required=true, и в тексте — явный якорь: возврат из ' +
      'симуляции к конкретной физической детали здесь-и-сейчас (что под ногами, какой звук, температура ' +
      'воздуха) плюс одно конкретное действие на завтра в реальном мире.',
    '— Не больше 2 архетипов на историю (shadow/anima_animus/trickster/persona/great_mother/self). Если ' +
      'используешь "self" — Самость не персонаж, а цель дуги; она не может впервые проявиться раньше ' +
      'предпоследней сцены, и это нужно указать в archetype_intro_scene.self.',
    '',
    mechanicsLine,
    '',
    'Запрещено (ENGINE.md §10, действует всегда, без исключений):',
    '— Предсказания будущего в любой форме, включая мягкие ("тебя ждёт").',
    '— Диагнозы и клинические ярлыки применительно к герою или пользователю.',
    '— Развилки, где насилие к себе или другим, самоповреждение или употребление — способ решить конфликт.',
    '— Разрушение рамки в любую сторону: ни "это просто игра, расслабься", ни "вселенная посылает знак".',
    '',
    'Ответ — строго один JSON-объект вида StoryCandidate, без пояснений до или после:',
    '{"seed":{"motifs":[...],"tone":"...","central_conflict":"...","archetypes":[...],' +
      '"archetype_intro_scene":{...?},"target_axes":[...],"blind_spot_to_seed":"...?"},' +
      '"scenes":[{"scene_index":1,"text":"...","anchor_required":false,' +
      '"choices":[{"choice_id":"ch_a","label":"...","axes":[{"axis":"...","pole":"A","weight":1}],' +
      '"cost":"..."}],"field_task":null}, ...]}',
  ].join('\n');
}

export function buildScenePrompt(dossier: SeedDossier): BuiltPrompt {
  const lines: string[] = [];

  lines.push('Материал для истории (правило контекста ENGINE §7.2 — это ВЕСЬ вход, сырых записей больше нет):');
  lines.push('');
  lines.push(`Зацепка (kind=${dossier.sourceKind}): ${dossier.sourceCatchText}`);

  if (dossier.sourceKind === 'repeat') {
    lines.push('');
    lines.push(REPEAT_KIND_NOTE);
  }

  if (dossier.distillateSymbols.length > 0) {
    lines.push('');
    lines.push('Личный словарь символов (приоритетнее общей амплификации):');
    for (const s of dossier.distillateSymbols) lines.push(`— ${s.symbol}: ${s.meaning}`);
  }

  if (dossier.distillateFigures.length > 0) {
    lines.push('');
    lines.push('Карта персонажей (повторяющиеся фигуры из прошлых снов и историй):');
    for (const f of dossier.distillateFigures) lines.push(`— ${f.name} (${f.archetype})`);
  }

  if (dossier.activePatterns.length > 0) {
    lines.push('');
    lines.push('Активные паттерны последних недель:');
    for (const p of dossier.activePatterns) lines.push(`— ${p}`);
  }

  if (dossier.rollupSummary) {
    lines.push('');
    lines.push(`Свёртка периода: ${dossier.rollupSummary}`);
  }

  if (dossier.chartThemes.length > 0) {
    lines.push('');
    lines.push('Темы драматургии (джйотиш под капотом либо их дневниковый эквивалент — CONCEPT §11):');
    for (const t of dossier.chartThemes) lines.push(`— ${t}`);
  }

  if (dossier.underObservedAxes.length > 0) {
    lines.push('');
    lines.push(
      `Профилю не хватает наблюдений по осям: ${dossier.underObservedAxes.join(', ')}. ` +
        'Целенаправленно построй хотя бы одну развилку, задевающую каждую из них (ENGINE §8.3).',
    );
  }

  return { system: systemPrompt(dossier.showMechanics), user: lines.join('\n') };
}
