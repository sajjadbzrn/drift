//! drift native messaging host.
//!
//! A tiny relay that the Chrome/Firefox extension talks to. Its presence is
//! how the extension knows drift is installed, and every download request is
//! forwarded to drift through the `drift://add` deep link — drift (or the
//! already-running instance, via the single-instance plugin) picks the
//! download up exactly like the browser bookmarklet flow.
//!
//! Protocol (identical for Chrome and Firefox):
//!   1. 4-byte little-endian message length
//!   2. UTF-8 JSON payload
//!
//! NEVER write anything to stdout except protocol frames — the browser will
//! kill the connection if it sees stray bytes. Use stderr for logging.

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::io::{self, Read, Write};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_FRAME: usize = 16 * 1024 * 1024;

fn read_frame() -> Option<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    if io::stdin().read_exact(&mut len_buf).is_err() {
        return None;
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > MAX_FRAME {
        return None;
    }
    let mut buf = vec![0u8; len];
    if io::stdin().read_exact(&mut buf).is_err() {
        return None;
    }
    Some(buf)
}

fn write_frame(msg: &Value) {
    let payload = serde_json::to_vec(msg).unwrap_or_default();
    let mut out = io::stdout();
    let len = (payload.len() as u32).to_le_bytes();
    // Best-effort: if stdout is gone (browser closed the port) we just exit.
    if out.write_all(&len).is_err() || out.write_all(&payload).is_err() {
        std::process::exit(0);
    }
    let _ = out.flush();
}

fn encode_param(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

/// Fire a `drift://add?url=…&filename=…&referrer=…` deep link. The OS routes
/// it to drift: a fresh instance (cold start, the frontend picks the URL up
/// via `getCurrent()`) or the running one (single-instance forwards it).
fn fire_deep_link(url: &str, filename: Option<&str>, referrer: Option<&str>) -> Result<(), String> {
    let mut uri = format!("drift://add?url={}", encode_param(url));
    if let Some(f) = filename {
        if !f.is_empty() {
            uri.push_str(&format!("&filename={}", encode_param(f)));
        }
    }
    if let Some(r) = referrer {
        if !r.is_empty() {
            uri.push_str(&format!("&referrer={}", encode_param(r)));
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide: Vec<u16> = std::ffi::OsStr::new(&uri)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(), // hwnd
                std::ptr::null(),     // operation ("open")
                wide.as_ptr(),        // file (the drift:// URI)
                std::ptr::null(),     // parameters
                std::ptr::null(),     // directory
                SW_SHOWNORMAL,
            )
        };
        // ShellExecuteW returns a value > 32 on success (HINSTANCE).
        if result as isize > 32 {
            Ok(())
        } else {
            Err(format!(
                "ShellExecuteW failed with code {}",
                result as isize
            ))
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (uri,);
        Err("drift deep links are only supported on Windows".into())
    }
}

fn handle(msg: Value) -> Value {
    let ty = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match ty {
        "ping" => json!({ "type": "pong", "version": VERSION }),
        "add" => {
            let url = msg.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                return json!({ "ok": false, "error": "missing url" });
            }
            let filename = msg.get("filename").and_then(|v| v.as_str());
            let referrer = msg.get("referrer").and_then(|v| v.as_str());
            match fire_deep_link(url, filename, referrer) {
                Ok(()) => json!({ "ok": true }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "addBatch" => {
            let urls: Vec<&str> = msg
                .get("urls")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).collect())
                .unwrap_or_default();
            // Pace the deep links: each one can spawn a short-lived drift.exe
            // when the app is running (single-instance forwards the URL), and
            // a burst would spawn several. 120 ms keeps it calm.
            for (i, u) in urls.into_iter().enumerate() {
                if i > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                }
                if let Err(e) = fire_deep_link(u, None, None) {
                    return json!({ "ok": false, "error": e });
                }
            }
            json!({ "ok": true })
        }
        _ => json!({ "ok": false, "error": "unknown message type" }),
    }
}

fn main() {
    eprintln!("drift-host {VERSION} started");
    while let Some(frame) = read_frame() {
        let msg: Value = match serde_json::from_slice(&frame) {
            Ok(v) => v,
            Err(e) => {
                write_frame(&json!({ "ok": false, "error": e.to_string() }));
                continue;
            }
        };
        let resp = handle(msg);
        write_frame(&resp);
    }
    eprintln!("drift-host {VERSION} exiting (stdin closed)");
}
