import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

type NativeBackHandler = () => boolean;
type NativeResumeHandler = () => void;
type NativeKeyboardHideHandler = () => void;

let nativeControlsStarted = false;
let lastNativeResumeAt = 0;
const nativeBackHandlers: NativeBackHandler[] = [];
const nativeResumeHandlers: NativeResumeHandler[] = [];

export function startNativeControls() {
  if (nativeControlsStarted || !Capacitor.isNativePlatform()) {
    return;
  }
  nativeControlsStarted = true;

  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      emitNativeResume();
    }
  });
  void App.addListener("resume", emitNativeResume);
  void App.addListener("backButton", ({ canGoBack }) => {
    for (const handler of [...nativeBackHandlers].reverse()) {
      if (handler()) {
        return;
      }
    }
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}

export function addNativeResumeHandler(handler: NativeResumeHandler) {
  nativeResumeHandlers.push(handler);
  return () => {
    const index = nativeResumeHandlers.lastIndexOf(handler);
    if (index >= 0) {
      nativeResumeHandlers.splice(index, 1);
    }
  };
}

export function addNativeBackHandler(handler: NativeBackHandler) {
  nativeBackHandlers.push(handler);
  return () => {
    const index = nativeBackHandlers.lastIndexOf(handler);
    if (index >= 0) {
      nativeBackHandlers.splice(index, 1);
    }
  };
}

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function addNativeKeyboardHideHandler(handler: NativeKeyboardHideHandler) {
  if (!isNativeAndroid() || !Capacitor.isPluginAvailable("Keyboard")) {
    return () => {};
  }

  let disposed = false;
  let removeListener: (() => void) | null = null;
  void Keyboard.addListener("keyboardDidHide", handler)
    .then((handle) => {
      removeListener = () => {
        void handle.remove();
      };
      if (disposed) {
        removeListener();
      }
    })
    .catch((error) => {
      console.warn("keyboard hide listener unavailable", error);
    });

  return () => {
    disposed = true;
    removeListener?.();
  };
}

function emitNativeResume() {
  const now = Date.now();
  if (now - lastNativeResumeAt < 250) {
    return;
  }
  lastNativeResumeAt = now;
  for (const handler of [...nativeResumeHandlers]) {
    handler();
  }
}
