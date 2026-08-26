import { useEffect, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { useSession } from '../store/session';
import { KIND_LABEL, WAKING_KINDS, type CatchKind } from '../types/domain';
import { tg, inTelegram, haptic } from '../lib/telegram';
import './CatchScreen.css';

/** Ночной сон стоит последним намеренно: продукт про сон наяву, ночной — частный случай. */
const KINDS: CatchKind[] = [...WAKING_KINDS, 'dream'];

export function CatchScreen() {
  const { draftKind, draftText, setDraftKind, setDraftText, clearDraft } = useSession();
  const [saved, setSaved] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const canSave = draftText.trim().length > 0;

  const save = () => {
    if (!useSession.getState().draftText.trim()) return;
    // TODO: отправка на бэкенд. Пока фиксируем черновик и показываем подтверждение.
    haptic('medium');
    clearDraft();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  // Главная кнопка Telegram — основной способ сохранить запись внутри мессенджера.
  useEffect(() => {
    const app = tg();
    if (!app) return;
    app.MainButton.setText('Записать');
    app.MainButton.show();
    app.MainButton.onClick(save);
    return () => app.MainButton.offClick(save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const app = tg();
    if (!app) return;
    if (canSave) app.MainButton.enable();
    else app.MainButton.disable();
  }, [canSave]);

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
        <button className="catch__save" onClick={save} disabled={!canSave}>Записать</button>
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

      {saved && <div className="catch__saved" role="status">Записано</div>}
    </Screen>
  );
}
