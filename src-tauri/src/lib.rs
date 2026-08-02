mod download;
mod models;

use crate::download::DownloadManager;
use crate::models::{AppSettings, DownloadInfo, UrlMeta};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
async fn probe_url(state: State<'_, Arc<DownloadManager>>, url: String) -> Result<UrlMeta, String> {
    download::probe_url(state.client(), &url).await
}

#[tauri::command]
async fn start_download(
    state: State<'_, Arc<DownloadManager>>,
    url: String,
    path: String,
    speed_limit: Option<u64>,
    segmented: Option<bool>,
) -> Result<DownloadInfo, String> {
    state.inner().start_download(url, path, speed_limit, segmented).await
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
    state.cancel(&id)
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
    state.set_settings(settings);
    state.persist();
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let lang = app
        .state::<Arc<DownloadManager>>()
        .settings
        .lock()
        .unwrap()
        .language
        .clone();
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
    let menu = Menu::with_items(app, &[&show, &pause_all, &resume_all, &sep, &quit])?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        }))
        .on_window_event(|window, event| {
            // Close-to-tray: the X button hides the window so downloads keep
            // running. Quit via the tray menu fully exits the app.
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
        })
        .setup(|app| {
            let (infos, settings) = DownloadManager::load_state(app.handle());
            let manager = Arc::new(DownloadManager::new(app.handle().clone(), settings));
            for info in infos {
                manager.restore_entry(info);
            }
            app.manage(manager);

            // drift://add?url=<encoded> — lets the browser (via a bookmarklet or
            // extension) hand links straight to drift.
            {
                let handle = app.handle().clone();
                app.deep_link().register("drift")?;
                let _ = app.deep_link().on_open_url(move |event| {
                    if let Some(url) = event.urls().first() {
                        let _ = handle.emit("drift://incoming", url.to_string());
                    }
                });
            }

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
            get_downloads,
            get_settings,
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
