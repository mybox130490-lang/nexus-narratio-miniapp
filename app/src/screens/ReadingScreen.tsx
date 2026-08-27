import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { getCurrentScene, submitChoice, completeRun, type CurrentScene } from '../lib/api';
import { haptic } from '../lib/telegram';
import './ReadingScreen.css';

type Status =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'reading' }
  | { kind: 'completed' };

const SCORES: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

export function ReadingScreen() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [scene, setScene] = useState<CurrentScene | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  // Пауза до выбора — материал для разбора (ENGINE §8.6), меряется здесь,
  // а не на сервере: сервер видит только момент, когда пришёл запрос.
  const sceneStartedAt = useRef(0);

  const load = useCallback(async (runId?: string) => {
    setStatus({ kind: 'loading' });
    setError(null);
    const result = await getCurrentScene(runId);
    if (!result.ok) {
      const message =
        result.reason === 'no_backend' ? 'Бэкенд ещё не подключён.'
        : result.reason === 'no_telegram' ? 'Это работает внутри Telegram.'
        : result.reason === 'no_run' ? 'Пока нет истории для чтения — она вырастает из записей улова.'
        : `Не удалось загрузить: ${result.error ?? 'неизвестная ошибка'}`;
      setStatus({ kind: 'unavailable', message });
      return;
    }
    setScene(result.scene);
    setScore(null);
    sceneStartedAt.current = Date.now();
    setStatus({ kind: 'reading' });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- загрузка текущей сцены при входе на экран, а не производное состояние
    void load();
  }, [load]);

  const choose = useCallback(async (choiceId?: string, avoidance?: boolean) => {
    if (!scene || busy) return;
    setBusy(true);
    setError(null);
    const decisionMs = Date.now() - sceneStartedAt.current;
    const result = await submitChoice({ runId: scene.runId, sceneId: scene.sceneId, choiceId, avoidance, decisionMs });
    haptic(result.ok ? 'medium' : 'heavy');
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    await load(scene.runId);
    setBusy(false);
  }, [scene, busy, load]);

  const submitScore = useCallback(async () => {
    if (!scene || score === null || busy) return;
    setBusy(true);
    setError(null);
    const result = await completeRun(scene.runId, score);
    haptic(result.ok ? 'medium' : 'heavy');
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus({ kind: 'completed' });
  }, [scene, score, busy]);

  if (status.kind === 'loading') {
    return (
      <Screen eyebrow="погружение" title="Чтение">
        <p className="reading__hint">Загружаю…</p>
      </Screen>
    );
  }

  if (status.kind === 'unavailable') {
    return (
      <Screen eyebrow="погружение" title="Чтение" lead={status.message}>
        <button className="reading__retry" onClick={() => void load()}>Проверить снова</button>
      </Screen>
    );
  }

  if (status.kind === 'completed') {
    return (
      <Screen eyebrow="погружение" title="Возврат" lead="История дочитана. То, что в ней было, теперь снова здесь — в яви.">
        <button className="reading__retry" onClick={() => void load()}>К следующей истории</button>
      </Screen>
    );
  }

  if (!scene) return null;

  return (
    <Screen
      eyebrow={`сцена ${scene.sceneIndex} из ${scene.scenesTotal}`}
      title={scene.isFinal ? 'Якорь' : undefined}
      footer={
        scene.isFinal ? (
          <button className="reading__submit" onClick={() => void submitScore()} disabled={score === null || busy}>
            {busy ? 'Отправляю…' : 'Завершить'}
          </button>
        ) : undefined
      }
    >
      <p className="reading__text">{scene.text}</p>

      {!scene.isFinal && (
        <div className="reading__choices">
          {scene.choices.map((c) => (
            <button
              key={c.choice_id}
              className="reading__choice"
              disabled={busy}
              onClick={() => void choose(c.choice_id)}
            >
              <span className="reading__choice-label">{c.label}</span>
              <span className="reading__choice-cost">{c.cost}</span>
            </button>
          ))}
          <button className="reading__skip" disabled={busy} onClick={() => void choose(undefined, true)}>
            Не выбирать
          </button>
        </div>
      )}

      {scene.fieldTask && (
        <div className="reading__task">
          <div className="reading__task-label">Полевое задание</div>
          <p>{scene.fieldTask.text}</p>
          <span className="reading__task-hint">можно пропустить — действует {scene.fieldTask.expires_hours} ч</span>
        </div>
      )}

      {scene.isFinal && (
        <div className="reading__score">
          <p className="reading__hint">Насколько это было похоже на что-то из твоей жизни?</p>
          <div className="reading__score-row" role="radiogroup" aria-label="Узнавание">
            {SCORES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={score === s}
                className={'reading__score-btn' + (score === s ? ' reading__score-btn--on' : '')}
                onClick={() => setScore(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="reading__error" role="alert">{error}</div>}
    </Screen>
  );
}
