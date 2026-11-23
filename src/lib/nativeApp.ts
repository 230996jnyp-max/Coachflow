import { useSyncExternalStore } from "react";

/**
 * True inside the CoachFlow iPhone app (the Capacitor wrapper adds "CoachFlowIOS" to the browser's user agent). Apple's rules for that
 * app differ from the website: no buying or managing a subscription inside it, and no Google / Facebook / Microsoft sign-in buttons
 * (Apple would then require Sign in with Apple). Everything else works exactly as on the web.
 */
export const isIosApp = (): boolean => typeof navigator !== "undefined" && /CoachFlowIOS/.test(navigator.userAgent);

const never = () => () => {};
/** The same, for components: false while the page is first drawn on the server, then true inside the iPhone app. */
export function useIosApp(): boolean {
  return useSyncExternalStore(never, isIosApp, () => false);
}

/** What the screens say where the website would sell or manage a plan. It deliberately offers no price, button or link. */
export const IOS_PLAN_NOTE = "Plans and payments aren't available in this app. Everything else works as usual.";
