# Changelog

All notable changes to drift are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-09-11

A performance and polish release: the UI now re-renders only what actually
changed during a download, and segmented downloads show each connection's
progress.

### Performance

- **Batched progress updates.** `download://progress` events are coalesced into
  a throttled state update instead of one React render per event per download.
  Renders are now bounded by time rather than by how many downloads are active.
- **Downloads keep their identity.** A progress tick only replaces the entries
  that actually emitted, so untouched downloads compare equal and are skipped.
- **Memoized cards and list.** `DownloadCard` and `DownloadList` are memoized and
  use referentially stable, id-based callbacks — previously every card
  re-rendered on every tick because of freshly created inline handlers.
- **Memoized shell.** The titlebar and the Three.js backdrop no longer re-render
  on each progress tick.
- **Vendor chunking.** Three.js and React are emitted as separate build chunks
  (this is what `vite.config.ts` already intended) so the app entry stays small
  and the vendors cache across releases.

### Added

- **Per-connection progress bars.** Segmented downloads draw one slim bar per
  segment, filled by that connection's own byte range, so a lagging segment is
  obvious at a glance. The Rust backend now publishes live per-segment byte
  counts (previously only the aggregate total was live, so per-segment figures
  were stale until the attempt ended).

### Improved

- Selection now reads as a soft ring with a tinted surface instead of a hard
  outline, and row actions stay visible on selected or keyboard-focused cards.
- Cards gained a subtle top highlight, and the progress bar is slightly thicker
  with a calmer glow.
- Paused downloads render their progress bar desaturated so they no longer look
  like they are still transferring.
- Fixed an undefined `--text-dim` CSS token that left the download preview
  modal's secondary text unstyled.

### Design

- **Consolidated file-type colour.** Eleven per-kind hues became six groups
  (media, developer, audio/archive, document, executable, unknown) tuned to one
  lightness band and measured at 3:1 or better on both surfaces. The icon says
  what a file is; colour is a secondary cue, so it no longer competes with the
  live progress bar for attention.
- **Removed idle decoration.** The animated sheen sweeps, the pulsing logo glow,
  the floating empty-state mark and the always-on flowing gradient borders are
  gone. Motion now means something is happening.
- Metadata rows use a hairline rule instead of `· ` between joins, and copy no
  longer leans on spaced em dashes.

### Accessibility

- Contrast is now measured rather than assumed: every text token clears 4.5:1
  on both the app surface and the raised surface in both themes — including the
  light theme's accent, success, warning and error colours, which previously
  did not.
- The download list is a real `listbox` with `option` rows, `aria-selected`, and
  `aria-activedescendant` tracking the keyboard cursor, so screen readers follow
  arrow-key navigation.
- Toasts announce through a polite live region, with errors promoted to `alert`.
- Decorative images carry intrinsic dimensions to stop layout shift, and
  overlays contain overscroll instead of chaining to the window behind them.
- The window `theme-color` follows the in-app theme (which is independent of the
  OS preference).

## [0.4.2]

- Download preview and toast fixes.

## [0.4.1]

- Creator section, GitHub community files, redesigned README.

## [0.4.0]

- Proxy support, auto-categorization, batch import and checksum verification.
