use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::json_store::validate_filename;

const CRASH_DIR_NAME: &str = "crash-reports";
const MAX_FILENAME_LEN: usize = 200;
const RECENT_CRASH_THRESHOLD_SECS: u64 = 300;

static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Sets the crash directory from the app handle. Call once in setup(), before
/// any fallible init work (tray, quick-pane, shortcuts) so panics during those
/// land in the proper app-data directory instead of the fallback.
pub fn set_app_crash_dir(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let crash_dir = dir.join(CRASH_DIR_NAME);
        let _ = CRASH_DIR.set(crash_dir);
    }
}

/// Installs a panic hook that writes structured crash reports to disk. Call as
/// the very first line of `run()`, before the Tauri Builder is constructed.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = write_panic_report(info);
        default_hook(info);
    }));
}

fn crash_dir() -> PathBuf {
    if let Some(dir) = CRASH_DIR.get() {
        return dir.clone();
    }
    #[cfg(target_os = "windows")]
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(profile)
            .join(".app-crash-reports")
            .join(CRASH_DIR_NAME);
    }
    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".app-crash-reports")
            .join(CRASH_DIR_NAME);
    }
    PathBuf::from(".").join(CRASH_DIR_NAME)
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn iso8601_now() -> String {
    let secs = now_epoch_secs();
    let days = secs / 86400;
    let day_secs = secs % 86400;
    let h = day_secs / 3600;
    let m = (day_secs % 3600) / 60;
    let s = day_secs % 60;

    // Civil date from day count (algorithm from howardhinnant.github.io)
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{d:02}T{h:02}-{m:02}-{s:02}Z")
}

fn write_panic_report(info: &std::panic::PanicHookInfo<'_>) -> Result<(), String> {
    let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "Unknown panic payload".to_string()
    };

    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "unknown".to_string());

    let backtrace = std::backtrace::Backtrace::force_capture();
    let timestamp = iso8601_now();

    let report = format!(
        "=== CRASH REPORT ===\n\
         Timestamp: {timestamp}\n\
         App Version: {version}\n\
         OS: {os} {arch}\n\n\
         --- Panic ---\n\
         Message: {message}\n\
         Location: {location}\n\n\
         --- Backtrace ---\n\
         {backtrace}\n",
        version = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
    );

    let dir = crash_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Creating crash dir: {e}"))?;

    let filename = format!("crash-{timestamp}.log");
    let path = dir.join(&filename);
    fs::write(&path, &report).map_err(|e| format!("Writing crash report: {e}"))?;

    eprintln!("Crash report written to {}", path.display());
    Ok(())
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportSummary {
    pub filename: String,
    pub timestamp_secs: u32,
    pub seconds_ago: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn log_frontend_error(
    app: AppHandle,
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
) -> Result<(), String> {
    let timestamp = iso8601_now();

    let mut report = format!(
        "=== FRONTEND ERROR REPORT ===\n\
         Timestamp: {timestamp}\n\
         App Version: {version}\n\
         OS: {os} {arch}\n\n\
         --- Error ---\n\
         {message}\n",
        version = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
    );

    if let Some(s) = stack {
        report.push_str(&format!("\n--- Stack Trace ---\n{s}\n"));
    }
    if let Some(cs) = component_stack {
        report.push_str(&format!("\n--- Component Stack ---\n{cs}\n"));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Resolving app data dir: {e}"))?
        .join(CRASH_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("Creating crash dir: {e}"))?;

    let filename = format!("frontend-error-{timestamp}.log");
    let path = dir.join(&filename);
    fs::write(&path, &report).map_err(|e| format!("Writing frontend error report: {e}"))?;

    log::error!("Frontend error logged to {}", path.display());
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn has_recent_crash(app: AppHandle) -> Result<Option<CrashReportSummary>, String> {
    let reports = list_crash_reports_inner(&app)?;
    if reports.is_empty() {
        return Ok(None);
    }

    let most_recent = &reports[0];
    if u64::from(most_recent.seconds_ago) <= RECENT_CRASH_THRESHOLD_SECS {
        Ok(Some(most_recent.clone()))
    } else {
        Ok(None)
    }
}

fn list_crash_reports_inner(app: &AppHandle) -> Result<Vec<CrashReportSummary>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Resolving app data dir: {e}"))?
        .join(CRASH_DIR_NAME);

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let now = now_epoch_secs();
    let mut reports: Vec<CrashReportSummary> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".log") {
                return None;
            }
            let ts = entry
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(CrashReportSummary {
                filename: name,
                timestamp_secs: ts as u32,
                seconds_ago: now.saturating_sub(ts) as u32,
            })
        })
        .collect();

    reports.sort_by_key(|r| std::cmp::Reverse(r.timestamp_secs));
    Ok(reports)
}

#[tauri::command]
#[specta::specta]
pub async fn list_crash_reports(app: AppHandle) -> Result<Vec<String>, String> {
    let reports = list_crash_reports_inner(&app)?;
    Ok(reports.into_iter().map(|r| r.filename).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_crash_report(app: AppHandle, name: String) -> Result<String, String> {
    validate_filename(&name, MAX_FILENAME_LEN)?;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Resolving app data dir: {e}"))?
        .join(CRASH_DIR_NAME);

    let path = dir.join(&name);
    if !path.starts_with(&dir) {
        return Err("Invalid crash report path".to_string());
    }

    fs::read_to_string(&path).map_err(|e| format!("Reading crash report: {e}"))
}

#[tauri::command]
#[specta::specta]
pub async fn clear_crash_reports(app: AppHandle) -> Result<u32, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Resolving app data dir: {e}"))?
        .join(CRASH_DIR_NAME);

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(0),
    };

    let mut removed = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("log")
            && fs::remove_file(&path).is_ok()
        {
            removed += 1;
        }
    }

    if removed > 0 {
        log::info!("Cleared {removed} crash report(s)");
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::scratch_dir;

    #[test]
    fn iso8601_format_is_valid() {
        let ts = iso8601_now();
        assert!(ts.ends_with('Z'));
        assert!(ts.contains('T'));
        assert_eq!(ts.len(), 20);
    }

    #[test]
    fn report_writing_round_trip() {
        let dir = scratch_dir("crash-reporter", "write");
        let crash_dir = dir.join(CRASH_DIR_NAME);
        fs::create_dir_all(&crash_dir).unwrap();

        let timestamp = iso8601_now();
        let report = format!("=== CRASH REPORT ===\nTimestamp: {timestamp}\nMessage: test panic\n");
        let filename = format!("crash-{timestamp}.log");
        let path = crash_dir.join(&filename);
        fs::write(&path, &report).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("test panic"));
    }

    #[test]
    fn list_and_clear_round_trip() {
        let dir = scratch_dir("crash-reporter", "list-clear");
        let crash_dir = dir.join(CRASH_DIR_NAME);
        fs::create_dir_all(&crash_dir).unwrap();

        fs::write(crash_dir.join("crash-2025-01-01.log"), "report 1").unwrap();
        fs::write(crash_dir.join("crash-2025-01-02.log"), "report 2").unwrap();
        fs::write(crash_dir.join("not-a-report.txt"), "ignored").unwrap();

        let logs: Vec<_> = fs::read_dir(&crash_dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("log"))
            .collect();
        assert_eq!(logs.len(), 2);

        for entry in &logs {
            fs::remove_file(entry.path()).unwrap();
        }

        let remaining: Vec<_> = fs::read_dir(&crash_dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("log"))
            .collect();
        assert_eq!(remaining.len(), 0);

        assert!(crash_dir.join("not-a-report.txt").exists());
    }

    #[test]
    fn path_traversal_is_rejected() {
        assert!(validate_filename("../escape.log", MAX_FILENAME_LEN).is_err());
        assert!(validate_filename("sub/file.log", MAX_FILENAME_LEN).is_err());
        assert!(validate_filename("sub\\file.log", MAX_FILENAME_LEN).is_err());
        assert!(validate_filename(".hidden", MAX_FILENAME_LEN).is_err());
    }

    #[test]
    fn frontend_error_report_format() {
        let dir = scratch_dir("crash-reporter", "frontend");
        let crash_dir = dir.join(CRASH_DIR_NAME);
        fs::create_dir_all(&crash_dir).unwrap();

        let timestamp = iso8601_now();
        let message = "TypeError: Cannot read property 'x' of undefined";
        let stack = "at Component.render (app.js:42:10)";

        let mut report = format!(
            "=== FRONTEND ERROR REPORT ===\nTimestamp: {timestamp}\n--- Error ---\n{message}\n"
        );
        report.push_str(&format!("\n--- Stack Trace ---\n{stack}\n"));

        let path = crash_dir.join(format!("frontend-error-{timestamp}.log"));
        fs::write(&path, &report).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("FRONTEND ERROR REPORT"));
        assert!(content.contains("TypeError"));
        assert!(content.contains("Stack Trace"));
    }
}
