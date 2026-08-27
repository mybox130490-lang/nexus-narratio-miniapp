/** Подсчёт слов для проверки объёма сцены (ENGINE §8.1: 400–700 слов). */
export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}
