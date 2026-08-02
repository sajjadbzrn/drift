#!/usr/bin/env node
/**
 * Generate the Tauri updater manifest (latest.json) from the built NSIS
 * artifacts so users can update in place (no uninstall/reinstall).
 *
 * Expects after `bun run tauri build --bundles nsis`:
 *   src-tauri/target/release/bundle/nsis/drift_<version>_x64-setup.exe
 *   src-tauri/target/release/bundle/nsis/drift_<version>_x64-setup.exe.sig
 *
 * Usage:
 *   bun scripts/make-update-json.mjs --version 0.2.0 --owner sajjad --repo drift
 *
 * The output latest.json is written next to the installer and should be
 * uploaded to the GitHub Release alongside the .exe and .sig.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

const version = (arg("version") ?? "").replace(/^v/, "");
const owner = arg("owner");
const repo = arg("repo");
if (!version || !owner || !repo) {
  console.error(
    "Usage: bun scripts/make-update-json.mjs --version 0.2.0 --owner <owner> --repo <repo>",
  );
  process.exit(1);
}

const bundleDir = join(process.cwd(), "src-tauri/target/release/bundle/nsis");
if (!existsSync(bundleDir)) {
  console.error(`Bundle directory not found: ${bundleDir}`);
  console.error("Run `bun run tauri build --bundles nsis` first.");
  process.exit(1);
}

const files = readdirSync(bundleDir);
const exe = files.find((f) => f.endsWith("-setup.exe"));
const sigFile = files.find((f) => f.endsWith("-setup.exe.sig"));
if (!exe || !sigFile) {
  console.error("Could not find the NSIS installer and its .sig in", bundleDir);
  process.exit(1);
}

const signature = readFileSync(join(bundleDir, sigFile), "utf8").trim();
const manifest = {
  version,
  notes: "",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${owner}/${repo}/releases/latest/download/${exe}`,
    },
  },
};

const out = join(bundleDir, "latest.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`✓ ${out}`);
console.log("\nUpload these three files to the GitHub Release:");
console.log(`  - ${exe}`);
console.log(`  - ${sigFile}`);
console.log(`  - latest.json`);
console.log("\nThe app fetches updates from:");
console.log(
  `  https://github.com/${owner}/${repo}/releases/latest/download/latest.json`,
);
