// Generate the Tauri updater manifest (latest.json) after a release build.
//
// Scans a bundle directory for every `.sig` file Tauri produced and builds a
// single combined manifest covering all platforms (Windows NSIS, Linux deb,
// macOS dmg). Each platform entry points at the matching installer in the
// GitHub release, so in-place updates work on every OS.
//
// Usage:
//   bun scripts/make-update-json.mjs --version v0.3.0 --owner <owner> --repo <repo> --dir <bundle-dir>

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { version: "", owner: "", repo: "", dir: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version" && argv[i + 1]) out.version = argv[++i];
    else if (a === "--owner" && argv[i + 1]) out.owner = argv[++i];
    else if (a === "--repo" && argv[i + 1]) out.repo = argv[++i];
    else if (a === "--dir" && argv[i + 1]) out.dir = argv[++i];
  }
  return out;
}

const { version: rawVersion, owner, repo, dir } = parseArgs(process.argv.slice(2));
if (!rawVersion || !owner || !repo) {
  console.error("usage: make-update-json.mjs --version <vX.Y.Z> --owner <owner> --repo <repo> [--dir <bundle-dir>]");
  process.exit(1);
}

const version = rawVersion.replace(/^v/, "");
const tag = `v${version}`;
const bundleDir = dir || join(root, "src-tauri", "target", "release", "bundle");

if (!existsSync(bundleDir)) {
  console.error(`bundle dir not found: ${bundleDir}`);
  process.exit(1);
}

// Map an installer filename to a Tauri updater platform key, or null to skip
// (e.g. AppImage — uploaded as an artifact but not used as the updater target).
function parsePlatform(installer) {
  const name = installer.toLowerCase();
  if (name.endsWith(".exe")) {
    return name.includes("arm64") ? "windows-aarch64" : "windows-x86_64";
  }
  if (name.endsWith(".deb")) {
    return name.includes("arm64") || name.includes("aarch64")
      ? "linux-aarch64"
      : "linux-x86_64";
  }
  if (name.endsWith(".appimage")) {
    return null; // distributed as a manual artifact, not an updater target
  }
  // The .dmg is only the installer; the updater replaces the .app bundle, so
  // Tauri's updater artifact is the signed .app.tar.gz.
  if (name.endsWith(".dmg")) {
    return null; // installer only — uploaded as a release artifact
  }
  if (name.endsWith(".app.tar.gz")) {
    if (name.includes("aarch64") || name.includes("arm64")) return "darwin-aarch64";
    if (name.includes("x64") || name.includes("x86_64")) return "darwin-x86_64";
    return "darwin-universal"; // universal / arch-ambiguous build
  }
  return null;
}

// Collect every .sig alongside its installer.
const sigs = [];
for (const entry of readdirSync(bundleDir)) {
  const full = join(bundleDir, entry);
  if (!existsSync(full) || !entry.endsWith(".sig")) continue;
  const installer = entry.slice(0, -".sig".length);
  const platform = parsePlatform(installer);
  if (!platform) continue;
  sigs.push({ installer, platform, sigPath: full });
}

if (sigs.length === 0) {
  console.error(`no signed bundles found in ${bundleDir}\nDid the build produce updater artifacts?`);
  process.exit(1);
}

const platforms = {};
for (const { installer, platform, sigPath } of sigs) {
  // First match per platform wins (deb before appimage is already filtered out).
  if (platforms[platform]) continue;
  const signature = readFileSync(sigPath, "utf8").trim();
  const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${installer}`;
  platforms[platform] = { signature, url };
  console.log(`  ${platform}: ${installer}`);
}

const manifest = {
  version,
  notes: `See https://github.com/${owner}/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};

const outPath = join(bundleDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote updater manifest -> ${outPath} (${Object.keys(platforms).length} platform(s))`);
