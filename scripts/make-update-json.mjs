// Generate the Tauri updater manifest (latest.json) after a release build.
//
// Reads the NSIS bundle's .sig file and writes latest.json next to it, so the
// release job can upload it alongside the installer.
//
// Usage:
//   bun scripts/make-update-json.mjs --version v0.3.0 --owner <owner> --repo <repo>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { version: "", owner: "", repo: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version" && argv[i + 1]) out.version = argv[++i];
    else if (a === "--owner" && argv[i + 1]) out.owner = argv[++i];
    else if (a === "--repo" && argv[i + 1]) out.repo = argv[++i];
  }
  return out;
}

const { version: rawVersion, owner, repo } = parseArgs(process.argv.slice(2));
if (!rawVersion || !owner || !repo) {
  console.error("usage: make-update-json.mjs --version <vX.Y.Z> --owner <owner> --repo <repo>");
  process.exit(1);
}

const version = rawVersion.replace(/^v/, "");
const tag = `v${version}`;

const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const setupName = `drift_${version}_x64-setup.exe`;
const sigPath = join(nsisDir, `${setupName}.sig`);

if (!existsSync(sigPath)) {
  console.error(`signature file not found: ${sigPath}\nDid the build produce the NSIS bundle?`);
  process.exit(1);
}

const signature = readFileSync(sigPath, "utf8").trim();
const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${setupName}`;

const manifest = {
  version,
  notes: `See https://github.com/${owner}/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url,
    },
  },
};

const outPath = join(nsisDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote updater manifest -> ${outPath}`);
