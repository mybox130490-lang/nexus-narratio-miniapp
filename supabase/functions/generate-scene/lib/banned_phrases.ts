/**
 * Запреты контракта генерации (ENGINE §10) — то, что не должно появиться
 * ни в тексте сцены, ни в подписи или цене выбора, независимо от того,
 * насколько удачна сцена во всём остальном. Это не про кризис в записи
 * пользователя (см. safety.ts в catch-ingest) — это про то, что сама
 * СГЕНЕРИРОВАННАЯ история не должна говорить.
 */

export interface BannedHit {
  category:
    | 'prediction'
    | 'jyotish_leak'
    | 'violence_resolution'
    | 'frame_break_mystical'
    | 'frame_break_dismissive'
    | 'diagnosis';
  phrase: string;
}

interface Rule { category: BannedHit['category']; pattern: RegExp }

// ВАЖНО: без флага 'u' и \p{L} движок JS считает кириллицу вне \w,
// поэтому \b вокруг русских слов не срабатывает — граница здесь не
// расставляется вообще, только подстрока. Ложные срабатывания на редких
// словах-подстроках дешевле пропущенной утечки (см. README функции).
const RULES: Rule[] = [
  // Предсказания будущего — включая мягкие формы (ENGINE §10).
  { category: 'prediction', pattern: /тебя ждёт/i },
  { category: 'prediction', pattern: /скоро (произойдёт|случится|наступит)/i },
  { category: 'prediction', pattern: /в будущем ты/i },
  { category: 'prediction', pattern: /(это|тебе) (предвещ|предсказ)/i },

  // Утечка джйотиш-механики: планеты, дома — под капотом, наружу не выходят.
  { category: 'jyotish_leak', pattern: /(сатурн|юпитер|марс|венера|меркурий|раху|кету)/i },
  { category: 'jyotish_leak', pattern: /\d{1,2}[-–]?(й|ый)? дом/i },
  { category: 'jyotish_leak', pattern: /(даш[аеу]|антардаш[аеу])/i },
  { category: 'jyotish_leak', pattern: /лагна/i },

  // Насилие или самоповреждение как решение конфликта в развилке.
  { category: 'violence_resolution', pattern: /(убе(й|ди)ть себя|причинить себе боль|навредить себе)/i },
  { category: 'violence_resolution', pattern: /(ударить|избить|убить)(,| )? чтобы (решить|разрешить)/i },
  { category: 'violence_resolution', pattern: /выпить,? (чтобы|для того чтобы) (забыть|заглушить|справиться)/i },

  // Разрушение рамки в мистическую сторону: «вселенная посылает знак».
  { category: 'frame_break_mystical', pattern: /вселенная (тебе )?(послала|посылает|отвечает)/i },
  { category: 'frame_break_mystical', pattern: /это (был )?знак свыше/i },
  { category: 'frame_break_mystical', pattern: /приложение предсказ/i },

  // Разрушение рамки в обесценивающую сторону: «это просто игра, расслабься».
  { category: 'frame_break_dismissive', pattern: /это просто игра,? расслабься/i },
  { category: 'frame_break_dismissive', pattern: /не принимай (это |всерьёз)/i },

  // Диагнозы и клинические ярлыки применительно к герою/пользователю.
  { category: 'diagnosis', pattern: /у тебя (депрессия|тревожное расстройство|пткср|птср)/i },
  { category: 'diagnosis', pattern: /это симптом (расстройства|болезни)/i },
];

export function scanBannedContent(text: string): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (match) hits.push({ category: rule.category, phrase: match[0] });
  }
  return hits;
}
