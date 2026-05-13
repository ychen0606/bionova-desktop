pub mod commands;
pub mod config;
pub mod data_inspector;
pub mod kernel;
pub mod keychain;
pub mod notebook;
pub mod op_log;
pub mod project;
pub mod providers;
pub mod python_probe;

#[cfg(test)]
pub(crate) mod test_helpers {
    use std::sync::Mutex;
    /// Shared lock for tests that mutate `$HOME`. Tests across modules race
    /// otherwise and clobber each other's tempdirs.
    pub static HOME_GUARD: Mutex<()> = Mutex::new(());
}

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
            commands::project_list,
            commands::project_create,
            commands::project_open,
            commands::project_delete,
            commands::notebook_save,
            commands::op_log_append,
            commands::op_log_set_head,
            commands::op_log_read,
            commands::data_list,
            commands::data_inspect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
