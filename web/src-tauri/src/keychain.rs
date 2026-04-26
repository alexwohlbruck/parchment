//! OS keychain wrapper (desktop only).
//!
//! Exposes three Tauri commands that proxy to the native OS keychain —
//! Apple Keychain on macOS, Credential Manager on Windows, libsecret /
//! Secret Service on Linux. Mobile platforms don't ship these commands;
//! the frontend falls back to its browser storage path there.
//!
//! Service name is the app bundle identifier (app.parchment), so entries
//! appear under "Parchment" in macOS Keychain.app.

use keyring::Entry;

const SERVICE: &str = "app.parchment";

#[tauri::command]
pub fn keychain_set(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_get(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn keychain_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
