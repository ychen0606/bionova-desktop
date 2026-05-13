pub mod commands;
pub mod config;
pub mod kernel;
pub mod keychain;
pub mod providers;
pub mod python_probe;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::keychain_set,
            commands::keychain_get,
            commands::keychain_delete,
            commands::provider_ping,
            commands::python_probe_windows,
            commands::run_smoke_cell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
