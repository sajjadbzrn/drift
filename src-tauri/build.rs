fn main() {
    // tauri-build validates `bundle.externalBin` during *any* cargo build of
    // the package, so the native messaging host binary must exist before we
    // compile. On a fresh clone (or before scripts/build-host.mjs has run),
    // drop a placeholder so `bun run tauri dev` keeps working; the script
    // replaces it with the real drift-host binary before bundling.
    let target = std::env::var("TARGET").unwrap_or_default();
    let suffix = if target.contains("windows") { ".exe" } else { "" };
    let dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("binaries");
    let path = dir.join(format!("drift-host-{target}{suffix}"));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(
            &path,
            b"placeholder - run `bun scripts/build-host.mjs` to build the real drift-host\n",
        );
    }

    tauri_build::build()
}
