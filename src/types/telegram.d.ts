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
    hideKeyboard?: () => void;
    openTelegramLink?: (url: string) => void;
    openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
    BackButton?: {
      isVisible?: boolean;
      show: () => void;
      hide: () => void;
      onClick: (callback: () => void) => void;
      offClick: (callback: () => void) => void;
    };
    HapticFeedback?: {
      impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
      notificationOccurred?: (type: "error" | "success" | "warning") => void;
      selectionChanged?: () => void;
    };
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
