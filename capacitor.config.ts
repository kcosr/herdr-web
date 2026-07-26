import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "dev.herdr.web",
  appName: "Herdr Web",
  webDir: "web/dist",
  backgroundColor: "#11111b",
  ios: {
    allowsLinkPreview: false,
    contentInset: "never",
    initialFocus: false,
    preferredContentMode: "mobile",
  },
  plugins: {
    Keyboard: {
      autoBackdropColor: "auto",
      resize: KeyboardResize.Native,
      style: KeyboardStyle.Dark,
    },
  },
  server: {
    androidScheme: "http",
    cleartext: true,
  },
};

export default config;
