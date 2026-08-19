use std::sync::OnceLock;
use std::time::Instant;

use serde::Serialize;
use tauri::AppHandle;

use super::crash_reporter;
use super::json_store::{data_file_path, load_json};
use crate::types::AppPreferences;

const PREFERENCES_FILE: &str = "preferences.json";

static START_TIME: OnceLock<Instant> = OnceLock::new();

/// Records the app's start time. Call once from setup().
pub fn mark_startup() {
    let _ = START_TIME.set(Instant::now());
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub app_name: String,
    pub app_version: String,
    pub os_name: String,
    pub os_arch: String,
    pub os_version: String,
    pub tauri_version: String,
    pub settings: serde_json::Value,
    pub recent_crash_reports: Vec<String>,
    pub memory_usage_bytes: Option<u32>,
    pub uptime_secs: Option<u32>,
}

#[tauri::command]
#[specta::specta]
pub async fn collect_diagnostics(
    app: AppHandle,
    tauri_version: String,
) -> Result<DiagnosticsReport, String> {
    let config = app.config();
    let app_name = config
        .product_name
        .as_deref()
        .unwrap_or("unknown")
        .to_string();
    let app_version = config.version.as_deref().unwrap_or("0.0.0").to_string();

    let prefs_path = data_file_path(&app, PREFERENCES_FILE)?;
    let prefs: AppPreferences = load_json(&prefs_path);
    let settings = sanitize_settings(&prefs);

    let crash_reports = crash_reporter::list_crash_reports(app.clone())
        .await
        .unwrap_or_default()
        .into_iter()
        .take(10)
        .collect();

    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs() as u32);
    let memory = memory_usage_bytes();

    Ok(DiagnosticsReport {
        app_name,
        app_version,
        os_name: std::env::consts::OS.to_string(),
        os_arch: std::env::consts::ARCH.to_string(),
        os_version: os_version(),
        tauri_version,
        settings,
        recent_crash_reports: crash_reports,
        memory_usage_bytes: memory,
        uptime_secs: uptime,
    })
}

fn sanitize_settings(prefs: &AppPreferences) -> serde_json::Value {
    serde_json::json!({
        "theme": prefs.theme,
        "language": prefs.language,
        "fontSize": prefs.font_size,
        "reducedMotion": prefs.reduced_motion,
        "pointerCursors": prefs.pointer_cursors,
        "windowEffects": prefs.window_effects,
    })
}

fn os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Windows (unknown version)".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| format!("macOS {}", s.trim()))
            .unwrap_or_else(|| "macOS (unknown version)".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|content| {
                content
                    .lines()
                    .find(|line| line.starts_with("PRETTY_NAME="))
                    .map(|line| {
                        line.trim_start_matches("PRETTY_NAME=")
                            .trim_matches('"')
                            .to_string()
                    })
            })
            .unwrap_or_else(|| "Linux (unknown distro)".to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}

fn memory_usage_bytes() -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::mem;
        use windows_sys::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows_sys::Win32::System::Threading::GetCurrentProcess;

        unsafe {
            let mut pmc: PROCESS_MEMORY_COUNTERS = mem::zeroed();
            let cb = mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if GetProcessMemoryInfo(GetCurrentProcess(), &mut pmc, cb) != 0 {
                Some(pmc.WorkingSetSize as u32)
            } else {
                None
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|content| {
                content
                    .lines()
                    .find(|line| line.starts_with("VmRSS:"))
                    .and_then(|line| {
                        line.split_whitespace()
                            .nth(1)
                            .and_then(|kb| kb.parse::<u32>().ok())
                            .map(|kb| kb.saturating_mul(1024))
                    })
            })
    }
    #[cfg(target_os = "macos")]
    {
        let pid = std::process::id();
        std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<u32>().ok())
            .map(|kb| kb.saturating_mul(1024))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_settings_includes_allowlist_only() {
        let prefs = AppPreferences::default();
        let sanitized = sanitize_settings(&prefs);
        let obj = sanitized.as_object().unwrap();
        assert!(obj.contains_key("theme"));
        assert!(obj.contains_key("language"));
        assert!(obj.contains_key("fontSize"));
        assert!(obj.contains_key("reducedMotion"));
        assert!(obj.contains_key("pointerCursors"));
        assert!(obj.contains_key("windowEffects"));
        assert!(!obj.contains_key("commandShortcuts"));
        assert!(!obj.contains_key("importedThemes"));
        assert!(!obj.contains_key("globalShortcut"));
        assert!(!obj.contains_key("lightProfile"));
        assert!(!obj.contains_key("darkProfile"));
    }

    #[test]
    fn os_version_does_not_panic() {
        let version = os_version();
        assert!(!version.is_empty());
    }

    #[test]
    fn memory_usage_returns_some_on_supported_platforms() {
        let mem = memory_usage_bytes();
        if cfg!(any(
            target_os = "windows",
            target_os = "linux",
            target_os = "macos"
        )) {
            assert!(mem.is_some(), "expected Some on this platform");
            assert!(mem.unwrap() > 0, "expected nonzero memory usage");
        }
    }

    #[test]
    fn mark_startup_records_time() {
        // OnceLock may already be set by another test, so just verify it
        // doesn't panic when called twice.
        mark_startup();
        let elapsed = START_TIME.get().map(|t| t.elapsed().as_secs());
        assert!(elapsed.is_some());
    }
}
