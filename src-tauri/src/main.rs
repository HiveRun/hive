// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#![deny(unsafe_code)]

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub fn main() {
    tauri::Builder::default()
        .menu(|handle| {
            let toggle_devtools =
                MenuItemBuilder::with_id("toggle-devtools", "Toggle Devtools").build(handle)?;

            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&toggle_devtools)
                .build()?;

            MenuBuilder::new(handle).item(&view_menu).build()
        })
        .on_menu_event(|app, event| {
            if event.id() == "toggle-devtools" {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                } else {
                    eprintln!("Failed to toggle devtools: main window is not available");
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
