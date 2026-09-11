import gsap from "gsap";

/**
 * Central GSAP animation helpers for drift. All animations are short and
 * springy to match the app's snappy feel, and every helper is a no-op when
 * the user prefers reduced motion.
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Small pop used for anything appearing in place (badges, chips, bars). */
export function popIn(el: Element, delay = 0) {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    el,
    { scale: 0.86, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.28, delay, ease: "back.out(2.2)", overwrite: true },
  );
}

/** Slide used for cards entering the list. */
export function cardIn(el: Element, delay = 0) {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    el,
    { y: 14, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.34, delay, ease: "power3.out", overwrite: true },
  );
}

/** Animate a progress bar fill to a target percentage width (0..100). */
export function barTo(el: Element, percent: number) {
  gsap.to(el, {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    duration: 0.35,
    ease: "power2.out",
    overwrite: true,
  });
}

/** Modal: backdrop fade + panel scale-up. Returns the cleanup fn. */
export function animateModal(backdrop: Element, panel: Element) {
  if (prefersReducedMotion()) return () => {};
  const ctx = gsap.context(() => {
    gsap.fromTo(
      backdrop,
      { opacity: 0 },
      { opacity: 1, duration: 0.18, ease: "power1.out" },
    );
    gsap.fromTo(
      panel,
      { opacity: 0, y: 18, scale: 0.965 },
      { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: "power3.out" },
    );
  });
  return () => ctx.revert();
}

/** Drawer: slide in from the trailing edge (RTL-aware handled via x). */
export function animateDrawer(el: Element) {
  if (prefersReducedMotion()) return () => {};
  const ctx = gsap.context(() => {
    gsap.fromTo(
      el,
      { xPercent: 12, opacity: 0 },
      { xPercent: 0, opacity: 1, duration: 0.34, ease: "power3.out" },
    );
  });
  return () => ctx.revert();
}

/** Toast: slide up + fade, with a springy settle. */
export function animateToast(el: Element) {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    el,
    { y: 20, opacity: 0, scale: 0.97 },
    { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.7)" },
  );
}

/** Selection toolbar appearing above the list. */
export function animateSelectionBar(el: Element) {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    el,
    { y: -10, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.25, ease: "power2.out" },
  );
}

/** Little shake for failed downloads or errors. */
export function shake(el: Element) {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    el,
    { x: 0 },
    { x: 6, duration: 0.07, repeat: 5, yoyo: true, ease: "power1.inOut", clearProps: "x" },
  );
}
