export {};

declare global {
  interface TelegramWebApp {
    initData?: string;
    initDataUnsafe?: { start_param?: string; user?: { id?: number; first_name?: string; last_name?: string } };
    colorScheme?: "light" | "dark";
    themeParams?: Record<string, string>;
    safeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
    contentSafeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
    ready: () => void;
    expand: () => void;
    setHeaderColor: (color: string) => void;
    setBackgroundColor: (color: string) => void;
    setBottomBarColor?: (color: string) => void;
    onEvent?: (eventType: string, callback: () => void) => void;
    offEvent?: (eventType: string, callback: () => void) => void;
    disableVerticalSwipes?: () => void;
    enableVerticalSwipes?: () => void;
    requestFullscreen?: () => void;
    isVersionAtLeast?: (version: string) => boolean;
    requestWriteAccess?: (callback?: (allowed: boolean) => void) => void;
    showScanQrPopup?: (params?: { text?: string }, callback?: (text: string) => boolean) => void;
    closeScanQrPopup?: () => void;
  }

  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}
