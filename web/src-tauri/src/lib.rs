use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Apply window vibrancy effects
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(window) = app.get_webview_window("main") {
                    apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        Some(10.0),
                    )
                    .unwrap_or_else(|e| {
                        log::warn!("Failed to apply vibrancy: {}", e);
                    });
                }
            }

            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_blur;
                if let Some(window) = app.get_webview_window("main") {
                    apply_blur(&window, Some((18, 18, 18, 125)))
                        .unwrap_or_else(|e| {
                            log::warn!("Failed to apply blur: {}", e);
                        });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
