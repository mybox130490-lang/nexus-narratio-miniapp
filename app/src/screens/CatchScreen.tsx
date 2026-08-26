import { useEffect, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { useSession } from '../store/session';
import { KIND_LABEL, WAKING_KINDS, type CatchKind } from '../types/domain';
import { tg, inTelegram, haptic } from '../lib/telegram';
import { submitCatch } from '../lib/api';
import './CatchScreen.css';

/** Ночной сон стоит последним намеренно: продукт про сон наяву, ночной — частный случай. */
const KINDS: CatchKind[] = [...WAKING_KINDS, 'dream'];

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'crisis'; message: string }
  | { kind: 'error'; message: string };

export function CatchScreen() {
  const { draftKind, draftText, setDraftKind, setDraftText, clearDraft } = useSession();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const canSave = draftText.trim().length > 0 && !submitting;

  const save = async () => {
    const text = useSession.getState().draftText.trim();
    if (!text) return;

    setSubmitting(true);
    setStatus({ kind: 'idle' });

    const result = await submitCatch({ kind: useSession.getState().draftKind, raw_text: text });

    setSubmitting(false);
    haptic(result.ok ? 'medium' : 'heavy');

    if (!result.ok) {
      // Черновик НЕ стирается при неудаче — потерять то, что человек уже
      // написал, хуже, чем попросить его нажать «Записать» ещё раз.
      const message =
        result.reason === 'no_backend' ? 'Бэкенд ещё не подключён — запись осталась только в черновике.'
        : result.reason === 'no_telegram' ? 'Это работает внутри Telegram — запись осталась в черновике.'
        : `Не получилось сохранить: ${result.error ?? 'неизвестная ошибка'}. Черновик цел.`;
      setStatus({ kind: 'error', message });
      return;
    }

    clearDraft();
    if (result.safety.active && result.safety.message) {
      setStatus({ kind: 'crisis', message: result.safety.message });
    } else {
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s)), 2200);
    }
  };

  // Главная кнопка Telegram — основной способ сохранить запись внутри мессенджера.
  useEffect(() => {
    const app = tg();
    if (!app) return;
    app.MainButton.setText('Записать');
    app.MainButton.show();
    const onClick = () => { void save(); };
    app.MainButton.onClick(onClick);
    return () => app.MainButton.offClick(onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const app = tg();
    if (!app) return;
    if (canSave) app.MainButton.enable();
    else app.MainButton.disable();
    if (submitting) app.MainButton.showProgress();
    else app.MainButton.hideProgress();
  }, [canSave, submitting]);

  // Поле растёт под текст: человек должен видеть всё, что написал, без прокрутки внутри поля.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [draftText]);

  return (
    <Screen
      eyebrow="улов"
      title={KIND_LABEL[draftKind].prompt}
      lead="Тридцать секунд и одна фраза. Ничего объяснять не нужно — объяснит потом сама запись."
      footer={!inTelegram() ? (
        <button className="catch__save" onClick={() => void save()} disabled={!canSave}>
          {submitting ? 'Записываю…' : 'Записать'}
        </button>
      ) : undefined}
    >
      <div className="catch__kinds" role="radiogroup" aria-label="Тип записи">
        {KINDS.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={draftKind === k}
            className={'catch__kind' + (draftKind === k ? ' catch__kind--on' : '')}
            onClick={() => { setDraftKind(k); haptic('light'); }}
          >
            {KIND_LABEL[k].title}
          </button>
        ))}
      </div>

      <textarea
        ref={areaRef}
        className="catch__area"
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        placeholder="у подъезда стояла чужая собака и смотрела прямо на меня"
        rows={3}
        autoComplete="off"
        spellCheck={false}
      />

      {draftKind === 'avert' && (
        <p className="catch__hint">
          Отвод — самая ценная запись и самая неудобная. Достаточно назвать, от чего отвернулся;
          рассматривать не нужно.
        </p>
      )}
      {draftKind === 'repeat' && (
        <p className="catch__hint">
          Повтор — это про настройку твоего внимания, а не про знак снаружи. Мы читаем его именно так.
        </p>
      )}

      {status.kind === 'saved' && <div className="catch__saved" role="status">Записано</div>}
      {status.kind === 'error' && <div className="catch__error" role="alert">{status.message}</div>}
      {status.kind === 'crisis' && (
        <div className="catch__crisis" role="alert">{status.message}</div>
      )}
    </Screen>
  );
}
