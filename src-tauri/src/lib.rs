mod download;
mod models;

use crate::download::DownloadManager;
use crate::models::{AppSettings, DownloadInfo, UrlMeta};
use std::sync::Arc;
use tauri::{Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let (infos, settings) = DownloadManager::load_state(app.handle());
            let manager = Arc::new(DownloadManager::new(app.handle().clone(), settings));
            for info in infos {
                manager.restore_entry(info);
            }
            app.manage(manager);
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
            get_downloads,
            get_settings,
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
