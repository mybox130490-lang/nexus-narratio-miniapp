/**
 * Достаёт JSON-объект из текстового ответа модели: сначала пробует ответ
 * целиком, потом — самый широкий блок между первой '{' и последней '}'
 * (на случай, если модель обрамила JSON пояснением вопреки просьбе в
 * system-промпте отвечать строго одним объектом).
 */
export function extractJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('в ответе модели не найден JSON-объект');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
