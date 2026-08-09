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

/// Build the `drift://add?url=…&filename=…&referrer=…&cookies=…` URI. Pure —
/// kept separate from the OS call so the framing/tests can exercise it.
fn build_add_uri(
    url: &str,
    filename: Option<&str>,
    referrer: Option<&str>,
    cookies: Option<&str>,
) -> String {
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
    if let Some(c) = cookies {
        if !c.is_empty() {
            uri.push_str(&format!("&cookies={}", encode_param(c)));
        }
    }
    uri
}

/// Ask Windows to open a `drift://` URI. The OS routes it to drift: a fresh
/// instance (cold start, the frontend picks the URL up via `getCurrent()`) or
/// the running one (single-instance forwards it).
fn fire_raw(uri: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide: Vec<u16> = std::ffi::OsStr::new(uri)
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
        let _ = uri;
        Err("drift deep links are only supported on Windows".into())
    }
}

/// Fire a `drift://add` deep link carrying url, optional filename/referrer and
/// optional cookies (forwarded by the extension for login-protected pages).
fn fire_deep_link(
    url: &str,
    filename: Option<&str>,
    referrer: Option<&str>,
    cookies: Option<&str>,
) -> Result<(), String> {
    fire_raw(&build_add_uri(url, filename, referrer, cookies))
}

fn handle(msg: Value) -> Value {
    let ty = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match ty {
        "ping" => json!({ "type": "pong", "version": VERSION }),
        "open" => match fire_raw("drift://open") {
            Ok(()) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": e }),
        },
        "add" => {
            let url = msg.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                return json!({ "ok": false, "error": "missing url" });
            }
            let filename = msg.get("filename").and_then(|v| v.as_str());
            let referrer = msg.get("referrer").and_then(|v| v.as_str());
            let cookies = msg.get("cookies").and_then(|v| v.as_str());
            match fire_deep_link(url, filename, referrer, cookies) {
                Ok(()) => json!({ "ok": true }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "addBatch" => {
            let items: Vec<Value> = msg
                .get("urls")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            // Each item is a plain URL string, or an object { url, cookies } —
            // the batch context menus send cookies so login-protected pages
            // download correctly. Pace the deep links: each one can spawn a
            // short-lived drift.exe when the app is running (single-instance
            // forwards the URL), and a burst would spawn several. 120 ms
            // keeps it calm.
            for (i, item) in items.iter().enumerate() {
                let (url, cookies) = match item {
                    Value::String(s) => (s.as_str(), None),
                    _ => (
                        item.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        item.get("cookies").and_then(|v| v.as_str()),
                    ),
                };
                if url.is_empty() {
                    continue;
                }
                if i > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                }
                if let Err(e) = fire_deep_link(url, None, None, cookies) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_responds_pong() {
        let resp = handle(json!({ "type": "ping" }));
        assert_eq!(resp["type"], "pong");
        assert_eq!(resp["version"], VERSION);
    }

    #[test]
    fn add_without_url_is_error() {
        let resp = handle(json!({ "type": "add" }));
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "missing url");
    }

    #[test]
    fn unknown_message_is_error() {
        let resp = handle(json!({ "type": "nope" }));
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "unknown message type");
    }

    #[test]
    fn add_batch_skips_empty_items() {
        // Only items that would ShellExecute a real URI are side-effecting;
        // empty/blank items never fire, so this is safe to run anywhere.
        let resp = handle(json!({ "type": "addBatch", "urls": ["", null, 5, {}] }));
        assert_eq!(resp["ok"], true);
    }

    #[test]
    fn uri_encodes_params_and_cookies() {
        let uri = build_add_uri(
            "https://a.com/f.bin",
            Some("f.bin"),
            Some("https://ref/x"),
            Some("sid=1; tok=a b"),
        );
        // NON_ALPHANUMERIC encodes '.' too (functional — decodes back cleanly).
        assert!(uri.starts_with("drift://add?url=https%3A%2F%2Fa%2Ecom%2Ff%2Ebin"));
        assert!(uri.contains("&filename=f%2Ebin"));
        assert!(uri.contains("&referrer=https%3A%2F%2Fref%2Fx"));
        assert!(uri.contains("&cookies=sid%3D1%3B%20tok%3Da%20b"));
    }

    #[test]
    fn uri_omits_empty_optional_params() {
        let uri = build_add_uri("https://a.com/f.bin", None, Some(""), Some(""));
        assert_eq!(uri, "drift://add?url=https%3A%2F%2Fa%2Ecom%2Ff%2Ebin");
    }
}
