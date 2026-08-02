# drift — download manager

A fast, modern download manager built with **Tauri 2**, **React 19** and **TypeScript**.
Segmented multi-connection downloads, pause/resume, speed limits, clipboard URL
detection, dark/light themes and English/Persian (RTL) interface.

## Development

```bash
bun install
bun run tauri dev      # or: bun run dev for the web UI only
```

The frontend runs on `http://localhost:1420` (Vite). The Rust backend lives in
`src-tauri/`.

## Features

- Segmented downloads (up to 8 parallel connections for files > 16 MB, with
  automatic fallback for servers without range support)
- Pause / resume / cancel, with state restored on restart
- Per-download and global speed limits
- Auto-retry with exponential backoff
- Clipboard URL detection, batch downloads (one URL per line), `drift://` deep links
- Native notifications, tray support (close-to-tray), queue reordering
- **English and Persian (فارسی) UI** — switch in Settings → Appearance → Language.
  Persian mode enables RTL layout, the Vazirmatn font and Persian digits.
- **In-app updates** — Settings → Updates, plus a silent check on launch.

## Releasing a new version (in-app updates)

Users update drift from inside the app (Settings → Updates) — no uninstall/reinstall.

### One-time setup

1. **Signing keys** (already generated in `.keys/`):
   - `.keys/drift.key` — your private key. **Back it up, never commit it.**
   - `.keys/drift.key.pub` — the public key, already embedded in
     `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
2. **GitHub repo**: already configured — the app fetches updates from
   `https://github.com/sajjadbzrn/drift/releases/latest/download/latest.json`
   (make sure the repo stays **public**; private repos can't serve update files
   to users without authentication).
3. **Secret**: add your private key as a repo secret named
   `TAURI_SIGNING_PRIVATE_KEY`.
   - Web UI: GitHub → repo → Settings → Secrets and variables → Actions →
     *New repository secret* → name `TAURI_SIGNING_PRIVATE_KEY`, value = the
     whole contents of `.keys/drift.key`.
   - Or CLI: `gh secret set TAURI_SIGNING_PRIVATE_KEY < .keys/drift.key`

### Every release

```bash
bun scripts/bump-version.mjs 0.2.0   # bumps package.json, tauri.conf.json, Cargo.toml
git add -A && git commit -m "Release v0.2.0"
git tag v0.2.0 && git push && git push --tags
```

The GitHub Actions workflow (`.github/workflows/release.yml`) then builds the
NSIS installer, signs it, generates `latest.json` and uploads everything to the
release. Users see "Update v0.2.0 is available" and update in place.

### Manual release (no GitHub Actions)

```bash
bun run tauri build --bundles nsis            # needs TAURI_SIGNING_PRIVATE_KEY set
bun scripts/make-update-json.mjs --version 0.2.0 --owner <owner> --repo <repo>
```

Then upload `*-setup.exe`, `*.exe.sig` and `latest.json` to a GitHub Release
(or any host matching the endpoint URL in `tauri.conf.json`).

> **Note:** the updater is only active in release builds — in `tauri dev` the
> update check is skipped. NSIS installs with `installMode: currentUser`, so
> updates replace the app in place and preserve your settings/downloads.
