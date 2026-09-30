#!/usr/bin/env node

// Builds the sidecar binaries Tauri bundles through `bundle.externalBin`.
//
// Each sidecar must end up at src-tauri/binaries/<name>-<target-triple>[.exe].
// Until one has been built, src-tauri/build.rs writes a zero-byte placeholder
// there so cargo check/clippy/test work on a fresh clone.
//
// Keep SIDECARS in sync with the `SIDECARS` const in src-tauri/build.rs.
const SIDECARS = []

if (SIDECARS.length === 0) {
  console.log('build:sidecars: no sidecars configured')
  process.exit(0)
}

// Per-sidecar build steps go here once the first sidecar exists.
console.error(
  `build:sidecars: no build step defined for: ${SIDECARS.join(', ')}`,
)
process.exit(1)
