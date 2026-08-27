/**
 * Какая сцена сейчас показывается пользователю. Прохождение не хранит
 * отдельного «курсора» — текущая сцена вычисляется из того, сколько сцен
 * уже получили пометку в choices (одна строка на осевую отметку или
 * avoidance — см. comment на таблице choices в 0001_init.sql).
 */

export interface CurrentSceneInput {
  scenesTotal: number;
  /** Число различных scene_id, по которым уже есть хотя бы одна строка choices. */
  resolvedSceneCount: number;
}

export interface CurrentSceneResult {
  /** 1-based индекс сцены, которую нужно показать сейчас. */
  sceneIndex: number;
  /** Все сцены, кроме последней, пройдены — остался только якорь. */
  isFinal: boolean;
  /** Прохождение вышло за пределы истории — сигнал несогласованных данных, не штатный путь. */
  overflow: boolean;
}

export function resolveCurrentScene({ scenesTotal, resolvedSceneCount }: CurrentSceneInput): CurrentSceneResult {
  const sceneIndex = Math.min(resolvedSceneCount + 1, scenesTotal);
  return {
    sceneIndex,
    isFinal: sceneIndex === scenesTotal,
    overflow: resolvedSceneCount >= scenesTotal,
  };
}
