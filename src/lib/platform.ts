/**
 * Lightweight platform detection for the frontend.
 *
 * Tauri's Android/iOS webviews report a normal browser User-Agent (e.g.
 * "...Android 13..."), so we sniff that rather than pulling in a plugin. This
 * is used to switch the app into a touch-friendly, mobile-sized layout and to
 * skip desktop-only flows (native save dialogs, opening files in Explorer, …).
 */

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isMobile(): boolean {
  return isAndroid() || isIOS();
}
