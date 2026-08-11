mod download;
mod host;
mod models;

use crate::download::DownloadManager;
use crate::host::NativeHostStatus;
use crate::models::{AppSettings, DownloadInfo, UrlMeta};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

// Deep links (drift://) are a desktop integration (browser extension handoff).
// The plugin is desktop-only here, so the import is gated to avoid an unused
// import on mobile.
#[cfg(not(mobile))]
use tauri_plugin_deep_link::DeepLinkExt;

// Tray + window-menu APIs are desktop-only. Gating the imports avoids unused-
// import warnings on mobile, where the tray functions below are also gated.
#[cfg(not(mobile))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(not(mobile))]
use tauri::tray::TrayIconBuilder;

#[tauri::command]
async fn probe_url(
    state: State<'_, Arc<DownloadManager>>,
    url: String,
    referrer: Option<String>,
    cookies: Option<String>,
) -> Result<UrlMeta, String> {
    download::probe_url(&state.client(), &url, referrer.as_deref(), cookies.as_deref()).await
}

#[tauri::command]
async fn start_download(
    state: State<'_, Arc<DownloadManager>>,
    url: String,
    path: String,
    speed_limit: Option<u64>,
    segmented: Option<bool>,
    referrer: Option<String>,
    cookies: Option<String>,
) -> Result<DownloadInfo, String> {
    state
        .inner()
        .start_download(url, path, speed_limit, segmented, referrer, cookies)
        .await
}

#[tauri::command]
fn set_speed_limit(
    state: State<'_, Arc<DownloadManager>>,
    id: String,
    limit: u64,
) -> Result<(), String> {
    state.set_speed_limit(&id, limit)
}

#[tauri::command]
fn pause_download(state: State<'_, Arc<DownloadManager>>, id: String) -> Result<(), String> {
    state.pause(&id)
}

#[tauri::command]
fn resume_download(state: State<'_, Arc<DownloadManager>>, id: String) -> Result<(), String> {
    state.inner().resume(&id)
}

#[tauri::command]
fn retry_download(state: State<'_, Arc<DownloadManager>>, id: String) -> Result<(), String> {
    state.inner().retry(&id)
}

#[tauri::command]
fn cancel_download(state: State<'_, Arc<DownloadManager>>, id: String) -> Result<(), String> {
    state.cancel(&id)?;
    state.flush();
    Ok(())
}

#[tauri::command]
fn remove_download(state: State<'_, Arc<DownloadManager>>, id: String) -> Result<(), String> {
    state.remove(&id)
}

#[tauri::command]
fn pause_all_downloads(state: State<'_, Arc<DownloadManager>>) -> usize {
    state.pause_all()
}

#[tauri::command]
fn resume_all_downloads(state: State<'_, Arc<DownloadManager>>) -> usize {
    state.inner().resume_all()
}

#[tauri::command]
fn reorder_download(
    state: State<'_, Arc<DownloadManager>>,
    id: String,
    to_index: usize,
) -> Result<(), String> {
    state.reorder(&id, to_index)
}

#[tauri::command]
fn get_downloads(state: State<'_, Arc<DownloadManager>>) -> Vec<DownloadInfo> {
    state.snapshot()
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<DownloadManager>>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(state: State<'_, Arc<DownloadManager>>, settings: AppSettings) -> Result<(), String> {
    let app = state.inner().app.clone();
    let lang_changed = {
        let cur = state.settings.lock().unwrap();
        cur.language != settings.language
    };
    state.set_settings(settings.clone());
    state.flush();
    // Keep the native messaging host manifest in sync (Chrome extension IDs).
    let _ = host::ensure_registered(&app, &settings);
    #[cfg(not(mobile))]
    if lang_changed {
        refresh_tray(&app, &settings.language);
    }
    Ok(())
}

#[tauri::command]
fn get_native_host_status(state: State<'_, Arc<DownloadManager>>) -> NativeHostStatus {
    host::status(&state.inner().app)
}

fn tray_tooltip_text(lang: &str, count: usize) -> String {
    if count > 0 {
        if lang == "fa" {
            format!("دریفت — {} دانلود فعال", count)
        } else {
            format!("drift — {} active download{}", count, if count == 1 { "" } else { "s" })
        }
    } else if lang == "fa" {
        "دریفت — مدیر دانلود".into()
    } else {
        "drift — download manager".into()
    }
}

#[tauri::command]
fn update_tray_tooltip(app: AppHandle, count: usize) {
    // The system tray (and its tooltip) is desktop-only.
    #[cfg(not(mobile))]
    {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let lang = app
                .state::<Arc<DownloadManager>>()
                .settings
                .lock()
                .unwrap()
                .language
                .clone();
            let _ = tray.set_tooltip(Some(&tray_tooltip_text(&lang, count)));
        }
    }
    #[cfg(mobile)]
    let _ = (app, count);
}

#[cfg(not(mobile))]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(not(mobile))]
fn tray_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let fa = lang == "fa";
    let show = MenuItem::with_id(
        app,
        "show",
        if fa { "نمایش / مخفی‌کردن دریفت" } else { "Show / Hide drift" },
        true,
        None::<&str>,
    )?;
    let pause_all = MenuItem::with_id(
        app,
        "pause_all",
        if fa { "توقف همه دانلودها" } else { "Pause all downloads" },
        true,
        None::<&str>,
    )?;
    let resume_all = MenuItem::with_id(
        app,
        "resume_all",
        if fa { "ادامه همه دانلودها" } else { "Resume all downloads" },
        true,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        if fa { "خروج از دریفت" } else { "Quit drift" },
        true,
        None::<&str>,
    )?;
    Menu::with_items(app, &[&show, &pause_all, &resume_all, &sep, &quit])
}

#[cfg(not(mobile))]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let lang = app
        .state::<Arc<DownloadManager>>()
        .settings
        .lock()
        .unwrap()
        .language
        .clone();
    let fa = lang == "fa";
    let menu = tray_menu(app.handle(), &lang)?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip(if fa {
            "دریفت — مدیر دانلود"
        } else {
            "drift — download manager"
        })
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let _tray = tray
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        show_main_window(app);
                    }
                }
            }
            "pause_all" => {
                app.state::<Arc<DownloadManager>>().pause_all();
            }
            "resume_all" => {
                app.state::<Arc<DownloadManager>>().inner().resume_all();
            }
            "quit" => {
                // app.exit() bypasses the close-to-tray CloseRequested guard.
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Rebuild the tray menu + tooltip in the current UI language. Called when the
/// language setting changes so the hidden-icon context menu localizes without
/// a restart.
#[cfg(not(mobile))]
fn refresh_tray(app: &AppHandle, lang: &str) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(menu) = tray_menu(app, lang) {
            let _ = tray.set_menu(Some(menu));
        }
        let count = app
            .state::<Arc<DownloadManager>>()
            .active
            .load(std::sync::atomic::Ordering::SeqCst);
        let _ = tray.set_tooltip(Some(&tray_tooltip_text(lang, count)));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Desktop + mobile plugins.
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init());

    // Desktop-only plugins: deep links (drift://), the updater, and
    // single-instance do not apply to / do not build for Android & iOS.
    #[cfg(not(mobile))]
    {
        builder = builder
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                // On Windows/Linux a deep link while the app is already running
                // arrives as a second instance — forward the URL to the frontend
                // before bringing the window back.
                if let Some(url) = args
                    .iter()
                    .find(|a| a.starts_with("drift://"))
                    .cloned()
                {
                    let _ = app.emit("drift://incoming", url);
                }
                show_main_window(app);
            }));
    }

    builder = builder
        .on_window_event(|window, event| {
            // Close-to-tray: the X button hides the window so downloads keep
            // running. Quit via the tray menu fully exits the app. This is a
            // desktop concept — on mobile, closing the window just exits.
            #[cfg(not(mobile))]
            {
                if window.label() == "main" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let to_tray = window
                            .app_handle()
                            .state::<Arc<DownloadManager>>()
                            .settings
                            .lock()
                            .unwrap()
                            .close_to_tray;
                        if to_tray {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                }
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .setup(|app| {
            let (infos, settings) = DownloadManager::load_state(app.handle());
            // Register the native messaging host so the browser extension can
            // detect drift and hand downloads to it.
            let _ = host::ensure_registered(app.handle(), &settings);
            let manager = Arc::new(DownloadManager::new(app.handle().clone(), settings));
            for info in infos {
                manager.restore_entry(info);
            }
            app.manage(manager);
            // Background task that flushes state to disk every 5s during active
            // downloads, avoiding per-change JSON serialize for large lists.
            app.state::<Arc<DownloadManager>>().start_batcher();

            // drift://add?url=<encoded> — lets the browser (via a bookmarklet or
            // extension) hand links straight to drift. Desktop only.
            #[cfg(not(mobile))]
            {
                let handle = app.handle().clone();
                app.deep_link().register("drift")?;
                let _ = app.deep_link().on_open_url(move |event| {
                    if let Some(url) = event.urls().first() {
                        let _ = handle.emit("drift://incoming", url.to_string());
                    }
                });
            }

            // System tray (desktop only).
            #[cfg(not(mobile))]
            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_url,
            start_download,
            pause_download,
            resume_download,
            retry_download,
            cancel_download,
            remove_download,
            pause_all_downloads,
            resume_all_downloads,
            reorder_download,
            set_speed_limit,
            get_downloads,
            get_settings,
            set_settings,
            get_native_host_status,
            update_tray_tooltip
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
