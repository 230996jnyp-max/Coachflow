import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The CoachFlow iPhone app is a native shell around the live site, so every website release reaches it with no App Store update.
 * "CoachFlowIOS" is added to the browser's user agent: the site reads it to follow Apple's rules for the app (no buying or managing
 * a subscription inside it, no Google / Facebook / Microsoft sign-in buttons, no marketing page with prices).
 */
const config: CapacitorConfig = {
  appId: "pro.coachflow.app",
  appName: "CoachFlow",
  webDir: "www",
  server: {
    url: "https://coachflow.pro",
    cleartext: false,
    // Links to any other site open in Safari instead of inside the app.
    allowNavigation: ["coachflow.pro"],
  },
  ios: {
    appendUserAgent: "CoachFlowIOS",
    contentInset: "never",
    backgroundColor: "#090B10",
    scheme: "CoachFlow",
  },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: "#090B10", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#090B10" },
  },
};

export default config;
