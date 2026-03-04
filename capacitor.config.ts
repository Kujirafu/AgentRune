import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "app.agentrune.dev",
  appName: "AgentRune",
  webDir: "dist",
  server: {
    androidScheme: "http",  // Use HTTP so we can fetch from LAN server without mixed-content block
    cleartext: true,
    allowNavigation: ["*"],
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  plugins: {
    Keyboard: {
      resize: "native",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0f172a",
    },
    SplashScreen: {
      backgroundColor: "#0f172a",
      showSpinner: false,
      launchAutoHide: true,
      launchShowDuration: 1000,
    },
  },
}

export default config
