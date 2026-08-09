import "@fontsource-variable/geist/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BridgeProvider } from "./bridge";
import { startNativeControls } from "./native";
import "./styles.css";

startNativeControls();

/** Runtime marker so you can confirm the loaded bundle in DevTools: `__HERDR_WEB__`. */
declare global {
  interface Window {
    __HERDR_WEB__?: {
      features: string[];
    };
  }
}

window.__HERDR_WEB__ = {
  features: ["browser-notifications", "web-push"],
};

// Register the push-capable service worker early (no-op off secure contexts).
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("missing root element");
}

createRoot(root).render(
  <StrictMode>
    <BridgeProvider>
      <App />
    </BridgeProvider>
  </StrictMode>,
);
