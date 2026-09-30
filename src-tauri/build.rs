use std::path::Path;

/// Sidecar binaries bundled via `bundle.externalBin`, by base name. Tauri
/// expects each at `binaries/<name>-<target-triple>[.exe]`; the real ones are
/// produced by `pnpm run build:sidecars` (keep its SIDECARS list in sync).
/// Empty until the first sidecar lands; add it to `externalBin` then too.
const SIDECARS: &[&str] = &[];

/// Writes a zero-byte stand-in for any sidecar that hasn't been built, so
/// `cargo check`/`clippy`/`test` work on a fresh clone. A bundle built with
/// a placeholder won't run that sidecar, hence the warning.
fn ensure_sidecar_placeholders() {
    // The directory is created up front (it is gitignored) because a
    // rerun-if-changed path that doesn't exist makes cargo rerun this script
    // on every build.
    let dir = Path::new("binaries");
    if let Err(e) = std::fs::create_dir_all(dir) {
        println!("cargo:warning=could not create {}: {e}", dir.display());
        return;
    }
    println!("cargo:rerun-if-changed=binaries");
    if SIDECARS.is_empty() {
        return;
    }
    let target = std::env::var("TARGET").expect("cargo sets TARGET for build scripts");
    let ext = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    for name in SIDECARS {
        let path = dir.join(format!("{name}-{target}{ext}"));
        if path.exists() {
            continue;
        }
        match std::fs::write(&path, []) {
            Ok(()) => println!(
                "cargo:warning=sidecar {name} not built; wrote an empty placeholder at {} (run `pnpm run build:sidecars`)",
                path.display()
            ),
            Err(e) => println!(
                "cargo:warning=sidecar {name} missing and no placeholder could be written at {}: {e}",
                path.display()
            ),
        }
    }
}

fn main() {
    // Windows: `cargo test` harness binaries get no application manifest of
    // their own (tauri-build only embeds one into the real executable), so
    // comctl32.dll resolves to the legacy v5 side-by-side assembly. That copy
    // does not export TaskDialogIndirect, a ComCtl32 v6 API pulled in via the
    // dependency tree, and the test binary dies with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139) before a single test runs.
    //
    // Delay-loading comctl32 defers symbol resolution to first use. Tests never
    // open a task dialog, so they now start cleanly; the real application is
    // unaffected because its embedded manifest gives it ComCtl32 v6 by the time
    // anything calls into the library.
    #[cfg(windows)]
    {
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-arg=delayimp.lib");
    }

    ensure_sidecar_placeholders();

    tauri_build::build()
}
