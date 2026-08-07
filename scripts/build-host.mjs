// Builds the native messaging host and places it where Tauri's externalBin
// expects it: src-tauri/binaries/drift-host-<target-triple>.exe.
//
//   bun scripts/build-host.mjs
//
// Run this before `bun run tauri build` (the CI release workflow does it
// automatically). CARGO_TARGET_TRIPLE can override the detected triple.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath is required on Windows: URL .pathname starts with a leading
// slash (/D:/...) which path.join mangles (e.g. down to just "D:").
const root = fileURLToPath(new URL("..", import.meta.url));
const srcTauri = join(root, "src-tauri");

function defaultTriple() {
  // Windows x64 is the only officially bundled target today.
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  return `${process.arch}-pc-${process.platform}`;
}

const triple = process.env.CARGO_TARGET_TRIPLE || defaultTriple();
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const srcExe = join(srcTauri, "target", "release", `drift-host${exeSuffix}`);
const outDir = join(srcTauri, "binaries");
const outExe = join(outDir, `drift-host-${triple}${exeSuffix}`);

// tauri-build validates bundle.externalBin during *any* cargo build of the
// package, so the destination file must exist before we compile. Drop a
// placeholder first; it gets replaced with the real binary below.
mkdirSync(outDir, { recursive: true });
if (!existsSync(outExe)) {
  writeFileSync(outExe, "placeholder\n");
}

console.log(`Building drift-host for ${triple}…`);
const build = spawnSync("cargo", ["build", "--release", "--bin", "drift-host"], {
  cwd: srcTauri,
  stdio: "inherit",
});
if (build.status !== 0) {
  // Never leave a junk placeholder that could be bundled as the host.
  rmSync(outExe, { force: true });
  console.error("drift-host build failed");
  process.exit(build.status ?? 1);
}
if (!existsSync(srcExe)) {
  rmSync(outExe, { force: true });
  console.error(`Expected build output at ${srcExe}`);
  process.exit(1);
}
copyFileSync(srcExe, outExe);
console.log(`Copied drift-host to ${outExe}`);
