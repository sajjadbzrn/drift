//! Native messaging host registration.
//!
//! Registers drift's companion `drift-host` executable as a native messaging
//! host with Chrome and Firefox. The host's presence is how the browser
//! extension knows drift is installed, and every download request it receives
//! is forwarded to drift through the `drift://add` deep link (see
//! `src/bin/drift_host.rs`).
//!
//! Registration happens at app startup and whenever the Chrome extension ID
//! setting changes. It is idempotent and self-healing: two HKCU registry keys
//! point at a JSON manifest written into drift's app data dir.

use crate::models::AppSettings;
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Native messaging host name. Must match the extension's connectNative call.
pub const HOST_NAME: &str = "com.sajjadbzn.drift.host";
/// Manifest file name inside the app data dir.
pub const HOST_MANIFEST_FILE: &str = "native-host.json";
/// Declared in the extension's manifest as browser_specific_settings.gecko.id.
pub const FIREFOX_EXTENSION_ID: &str = "drift-extension@sajjadbzrn.ir";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostStatus {
    pub registered: bool,
    pub manifest_path: Option<String>,
    pub host_path: Option<String>,
    pub allowed_origins: Vec<String>,
    pub allowed_extensions: Vec<String>,
}

/// Candidate file names for the host executable, tried in order next to the
/// running drift.exe. The first is the name Tauri's externalBin produces on
/// Windows x64 bundles; the plain names cover dev builds (cargo puts every
/// binary into target/debug|release next to each other).
fn host_exe_candidates() -> Vec<String> {
    vec![
        "drift-host-x86_64-pc-windows-msvc.exe".to_string(),
        "drift-host.exe".to_string(),
        "drift-host".to_string(),
    ]
}

fn find_host_exe() -> Option<PathBuf> {
    // A real binary is always > 1 KB; this skips the placeholder file that
    // build.rs / build-host.mjs leave behind until the host is built, so we
    // never register a manifest pointing at a junk file.
    let is_real = |p: &PathBuf| p.is_file() && p.metadata().map(|m| m.len()).unwrap_or(0) > 1024;
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    for name in host_exe_candidates() {
        let p = dir.join(&name);
        if is_real(&p) {
            return Some(p);
        }
    }
    // Tauri can place external binaries in a resources/ subfolder on some targets.
    for name in host_exe_candidates() {
        let p = dir.join("resources").join(&name);
        if is_real(&p) {
            return Some(p);
        }
    }
    None
}

fn manifest_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_default()
        .join(HOST_MANIFEST_FILE)
}

/// Current registration state, read back from disk. `registered` means both
/// the manifest exists and the host executable is present next to drift.
pub fn status(app: &AppHandle) -> NativeHostStatus {
    let mpath = manifest_path(app);
    let mut st = NativeHostStatus {
        registered: false,
        manifest_path: mpath.to_str().map(String::from),
        host_path: None,
        allowed_origins: vec![],
        allowed_extensions: vec![],
    };
    if let Ok(text) = std::fs::read_to_string(&mpath) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            st.host_path = v.get("path").and_then(|p| p.as_str()).map(String::from);
            st.allowed_origins = v
                .get("allowed_origins")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            st.allowed_extensions = v
                .get("allowed_extensions")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            st.registered = find_host_exe().is_some();
        }
    }
    st
}

/// (Re)write the host manifest and register it in the Windows registry under
/// both Chrome's and Firefox's NativeMessagingHosts keys. Skips the write when
/// nothing changed, so frequent settings updates stay cheap.
pub fn ensure_registered(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    #[cfg(windows)]
    {
        let Some(host_exe) = find_host_exe() else {
            // drift-host isn't built next to this binary (e.g. plain `cargo
            // build` of the app) — nothing to register yet.
            return Ok(());
        };

        let allowed_origins: Vec<String> = settings
            .chrome_ext_ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty())
            .map(|id| format!("chrome-extension://{id}/"))
            .collect();
        let manifest = json!({
            "name": HOST_NAME,
            "description": "drift download manager — native messaging host",
            "path": host_exe.to_string_lossy(),
            "type": "stdio",
            "allowed_origins": allowed_origins,
            "allowed_extensions": [FIREFOX_EXTENSION_ID],
        });

        let dir = app.path().app_data_dir().unwrap_or_default();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mpath = dir.join(HOST_MANIFEST_FILE);

        // Cheap change-detection: skip registry writes on every settings patch.
        let unchanged = std::fs::read_to_string(&mpath)
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .map(|old| {
                old.get("path").and_then(|p| p.as_str())
                    == manifest.get("path").and_then(|p| p.as_str())
                    && old.get("allowed_origins") == manifest.get("allowed_origins")
            })
            .unwrap_or(false);
        if unchanged {
            return Ok(());
        }

        std::fs::write(&mpath, serde_json::to_string_pretty(&manifest).unwrap())
            .map_err(|e| e.to_string())?;
        let manifest_str = mpath.to_string_lossy().to_string();

        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for browser in ["Google\\Chrome", "Mozilla"] {
            let path = format!(r"Software\{browser}\NativeMessagingHosts\{HOST_NAME}");
            let (key, _) = hkcu.create_subkey(&path).map_err(|e| e.to_string())?;
            key.set_value("", &manifest_str)
                .map_err(|e| e.to_string())?;
        }
        eprintln!("drift: registered native messaging host at {manifest_str}");
        Ok(())
    }

    #[cfg(not(windows))]
    {
        // drift targets Windows; there is nothing to register elsewhere.
        let _ = (app, settings);
        Ok(())
    }
}
