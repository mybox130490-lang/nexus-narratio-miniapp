/**
 * Тонкая обёртка над Telegram WebApp.
 * Всё, что знает о Telegram, живёт здесь: приложение должно запускаться и в браузере.
 */

interface TgMainButton {
  setText(text: string): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TgWebApp {
  ready(): void;
  expand(): void;
  close(): void;
  sendData(data: string): void;
  initData: string;
  colorScheme: 'light' | 'dark';
  MainButton: TgMainButton;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy'): void };
}

declare global {
  interface Window { Telegram?: { WebApp: TgWebApp } }
}

export const tg = (): TgWebApp | undefined => window.Telegram?.WebApp;

/** Запущены внутри Telegram или в обычном браузере (режим разработки). */
export const inTelegram = (): boolean => Boolean(tg()?.initData);

export function initTelegram(): void {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  tg()?.HapticFeedback?.impactOccurred(style);
}
