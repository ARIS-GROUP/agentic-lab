mod model;
mod monitor;

use monitor::Shared;
use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

#[tauri::command]
fn get_snapshot(state: tauri::State<Shared>) -> Option<model::Snapshot> {
    state.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn set_always_on_top(app: AppHandle, value: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    w.set_always_on_top(value).map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("app://visible", true);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: Shared = Arc::new(Mutex::new(None));
    let shared_setup = shared.clone();
    tauri::Builder::default()
        // Doit être enregistré en premier : relancer le raccourci réaffiche la fenêtre existante.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .manage(shared)
        .invoke_handler(tauri::generate_handler![get_snapshot, set_always_on_top])
        .setup(move |app| {
            let show = MenuItem::with_id(app, "show", "Afficher AgenticLab", true, None::<&str>)?;
            let top = CheckMenuItem::with_id(app, "top", "Toujours au premier plan", true, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &top, &quit])?;
            let top_item = top.clone();
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("AgenticLab")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, ev| match ev.id().as_ref() {
                    "show" => show_main(app),
                    "top" => {
                        let v = top_item.is_checked().unwrap_or(false);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_always_on_top(v);
                        }
                        let _ = app.emit("app://always-on-top", v);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            monitor::spawn(app.handle().clone(), shared_setup.clone());
            Ok(())
        })
        .on_window_event(|w, ev| match ev {
            // Fermer = réduire dans la zone de notification. Quitter via le menu du tray.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = w.hide();
                let _ = w.emit("app://visible", false);
            }
            WindowEvent::Resized(_) => {
                let min = w.is_minimized().unwrap_or(false);
                let _ = w.emit("app://visible", !min);
            }
            WindowEvent::Focused(f) => {
                let _ = w.emit("app://focused", *f);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running AgenticLab");
}
