// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#![deny(unsafe_code)]

use tauri::{CustomMenuItem, Manager, Menu, Submenu};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub fn main() {
    let toggle_devtools =
        CustomMenuItem::new("toggle-devtools".to_string(), "Toggle Devtools");
    let view_menu = Menu::new().add_item(toggle_devtools);
    let app_menu = Menu::new().add_submenu(Submenu::new("View", view_menu));

    tauri::Builder::default()
        .menu(app_menu)
        .on_menu_event(|event| {
            if event.menu_item_id() == "toggle-devtools" {
                let window = event.window();
                match window.is_devtools_open() {
                    Ok(true) => {
                        let _ = window.close_devtools();
                    }
                    Ok(false) => {
                        let _ = window.open_devtools();
                    }
                    Err(error) => {
                        eprintln!("Failed to toggle devtools: {error}");
                    }
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
