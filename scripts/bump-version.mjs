#!/usr/bin/env node
/**
 * Bump the drift version in every place it lives:
 *   - package.json
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml
 *
 * Usage:
 *   bun scripts/bump-version.mjs 0.2.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+/.test(next)) {
  console.error("Usage: bun scripts/bump-version.mjs <semver>  (e.g. 0.2.0)");
  process.exit(1);
}

// --- package.json
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`✓ package.json -> ${next}`);

// --- tauri.conf.json
const confPath = join(root, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = next;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\r\n");
console.log(`✓ src-tauri/tauri.conf.json -> ${next}`);

// --- Cargo.toml
const cargoPath = join(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${next}"`,
);
writeFileSync(cargoPath, cargo);
console.log(`✓ src-tauri/Cargo.toml -> ${next}`);

console.log("\nDone. Commit the changes, then tag the release:");
console.log(`  git add -A && git commit -m "Release v${next}"`);
console.log(`  git tag v${next} && git push && git push --tags`);
