// Build the native messaging host (src-tauri/src/bin/drift_host.rs) and place
// the binary where Tauri's `bundle.externalBin` expects it:
//   src-tauri/binaries/drift-host-<target-triple>[.exe]
//
// `build.rs` drops a placeholder there so `tauri dev` works before this runs;
// this script replaces that placeholder with the real binary.
//
// Usage:
//   bun scripts/build-host.mjs [--target <triple>]

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcTauri = join(root, "src-tauri");

function detectHostTriple() {
  const out = execSync("rustc -vV", { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.trimStart().startsWith("host:"));
  if (!line) throw new Error("could not detect host target triple from rustc -vV");
  return line.split(":")[1].trim();
}

const hostTriple = detectHostTriple();

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target" && argv[i + 1]) return argv[i + 1];
  }
  return process.env.TARGET || "";
}

// `passedTarget` is the triple the user explicitly requested. When empty (or
// equal to the host), cargo builds to target/release; otherwise to
// target/<triple>/release. We only pass --target when it differs from host.
const passedTarget = parseArgs(process.argv.slice(2));
const isCross = !!passedTarget && passedTarget !== hostTriple;
const target = passedTarget || hostTriple;
const isWindows = target.includes("windows");
const suffix = isWindows ? ".exe" : "";

// Where cargo puts the built binary.
const buildRoot = isCross ? join("target", passedTarget) : "target";
const source = join(srcTauri, buildRoot, "release", `drift-host${suffix}`);

// Where Tauri wants the external binary, named by target triple.
const destDir = join(srcTauri, "binaries");
const dest = join(destDir, `drift-host-${target}${suffix}`);

console.log(`Building drift-host for ${target}...`);
const cargoArgs = ["cargo", "build", "--release", "--bin", "drift-host"];
if (isCross) cargoArgs.push("--target", passedTarget);
execSync(cargoArgs.join(" "), { cwd: srcTauri, stdio: "inherit" });

if (!existsSync(source)) {
  throw new Error(`built binary not found at ${source}`);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
console.log(`Wrote native messaging host -> ${dest}`);
