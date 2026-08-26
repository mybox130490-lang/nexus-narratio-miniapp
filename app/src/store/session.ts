import { create } from 'zustand';
import type { CatchKind } from '../types/domain';

/**
 * Состояние сессии. Черновик улова живёт здесь и переживает переход между экранами:
 * человек может начать писать, отвлечься и вернуться — потерять текст недопустимо.
 */
interface SessionState {
  draftKind: CatchKind;
  draftText: string;
  setDraftKind: (kind: CatchKind) => void;
  setDraftText: (text: string) => void;
  clearDraft: () => void;
}

const DRAFT_KEY = 'turiya.draft';

const loadDraft = (): { kind: CatchKind; text: string } => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* приватный режим или заблокированное хранилище — не повод падать */ }
  return { kind: 'image', text: '' };
};

const saveDraft = (kind: CatchKind, text: string): void => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, text })); } catch { /* см. выше */ }
};

const initial = loadDraft();

export const useSession = create<SessionState>((set, get) => ({
  draftKind: initial.kind,
  draftText: initial.text,
  setDraftKind: (kind) => { set({ draftKind: kind }); saveDraft(kind, get().draftText); },
  setDraftText: (text) => { set({ draftText: text }); saveDraft(get().draftKind, text); },
  clearDraft: () => {
    set({ draftText: '' });
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* см. выше */ }
  },
}));
