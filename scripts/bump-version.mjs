// Bump the version across drift's manifest files in one go.
//
// Updates package.json (web), src-tauri/tauri.conf.json (bundle) and
// src-tauri/Cargo.toml (Rust) so a release is consistent.
//
// Usage:
//   bun scripts/bump-version.mjs <version>   # e.g. 0.3.0

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+([-.].+)?$/.test(version)) {
  console.error("usage: bump-version.mjs <semver>   # e.g. 0.3.0");
  process.exit(1);
}

// package.json
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

// tauri.conf.json
const confPath = join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n", "utf8");

// Cargo.toml — only the top-level [package] version line.
const cargoPath = join(root, "src-tauri", "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
writeFileSync(cargoPath, cargo, "utf8");

console.log(`Bumped version to ${version}`);
