# drift companion — browser extension

Chrome + Firefox (Manifest V3, one codebase) extension for the **drift**
download manager. Works like IDM's extension:

- **drift installed** → every http(s) download you start in the browser is
  handed to drift automatically (the browser copy is cancelled once drift
  picks it up). Right-click → *Download link/page/selection with drift* also
  available.
- **drift not installed** → downloads are never touched or interrupted; you
  get a tiny "!" badge on the toolbar and an install suggestion inside the
  popup, at most once a day.

## How it detects drift

drift registers a **native messaging host** (`com.sajjadbzn.drift.host`, a
tiny relay called `drift-host.exe`) on first run. The extension pings it via
`runtime.connectNative` — success means drift is installed. Every download
request is forwarded through the host, which fires the existing
`drift://add?url=…` deep link; drift (or the already-running instance) picks
it up exactly like the browser bookmarklet flow.

## Icons

`bun extension/icons/generate.mjs` generates `icons/icon{16,32,48,128}.png`
from the app's real logo (`public/drift.png`) with a zero-dependency PNG
decoder/resizer. Run it once (and after changing `drift.png`).

## Install (development)

### Chrome

1. `bun extension/icons/generate.mjs` — generate the PNG icons (only once).
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select the `extension/` folder.
3. Copy your extension's ID from `chrome://extensions`.
4. Open drift → **Settings → Browser integration**, paste the ID into the
   *Chrome extension ID* field and click **Save**.
5. Restart the browser (native host access is read at startup).

The popup will then show **"drift is connected"**. The ID must match exactly
once — after that it's permanent (extension IDs only change when you move the
folder or re-import with a different key).

> If the popup shows *"Allow this extension in drift"*, the ID in drift's
> settings doesn't match — the popup shows the ID drift needs.

### Firefox

1. `bun extension/icons/generate.mjs` — generate the PNG icons (only once).
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
   → select `extension/manifest.json`.
3. Firefox uses the fixed ID `drift-extension@sajjadbzrn.ir`, which drift
   allows by default — **no settings step needed**.

> Temporary add-ons are removed when Firefox restarts. For permanent
> installation, sign the extension on addons.mozilla.org (see below).

## Publishing

- **Chrome Web Store**: zip the `extension/` folder contents and upload. The
  store assigns a public ID — paste that ID into drift's settings and rebuild
  the release so users get a manifest that already includes it.
- **Firefox (AMO)**: submit the same zip; keep
  `browser_specific_settings.gecko.id` as `drift-extension@sajjadbzrn.ir` so
  the host stays allowed.

## Structure

```
extension/
  manifest.json        MV3 manifest (works in both browsers)
  background.js        host detection, auto-capture, context menus, nudge
  popup.html/js/css    status + toggle + install CTA
  _locales/            en + fa strings (chrome.i18n)
  icons/               generated PNGs + generator script
```

## Debugging

- **Chrome**: `chrome://extensions` → *service worker* → console.
- **Firefox**: `about:debugging` → *Inspect* on the extension.
- The host logs to stderr (visible when running `drift-host` from a terminal).
  Message framing is a 4-byte little-endian length + UTF-8 JSON — the same
  protocol Chrome and Firefox define for native messaging.
