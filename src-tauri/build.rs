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

    tauri_build::build()
}
