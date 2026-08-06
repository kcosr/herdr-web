import "@fontsource-variable/geist/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initAnalytics } from "./analytics";
import { App } from "./App";
import { BridgeProvider } from "./bridge";
import { startNativeControls } from "./native";
import "./styles.css";

startNativeControls();
initAnalytics();

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
