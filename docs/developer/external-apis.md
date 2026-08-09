# External APIs

This doc covers patterns for making HTTP requests and storing auth tokens in a
Tauri app. None of these are pre-wired in the template — they are the patterns
you reach for when your app needs external data.

## Rust `reqwest` vs frontend `fetch`

| Consideration | Rust (`reqwest`) | Frontend (`fetch`) |
| --- | --- | --- |
| CORS | Not subject to CORS | Subject to CORS |
| Token storage | Tokens stay in the Rust process | Tokens must cross IPC or live in JS |
| Streaming to UI | Must serialise and send over IPC | Direct access to response body |
| Binary size | Adds `reqwest` + TLS to the binary | No binary cost |

**Default to Rust** for anything that talks to a third-party API. CORS is a
non-issue, and secrets never leave the backend process.

**Use frontend `fetch`** only when the response is consumed directly in the UI
(e.g. a same-origin development proxy) or when you need streaming access that
would be awkward to serialise.

## Adding a Rust HTTP command

1. Add `reqwest` to `src-tauri/Cargo.toml`:
   ```toml
   reqwest = { version = "0.12", features = ["json"] }
   ```

2. Create a command module (e.g. `src-tauri/src/commands/my_api.rs`):
   ```rust
   #[tauri::command]
   #[specta::specta]
   pub async fn fetch_data(query: String) -> Result<MyResponse, String> {
       let resp = reqwest::get(format!("https://api.example.com/search?q={query}"))
           .await
           .map_err(|e| format!("Request failed: {e}"))?;
       resp.json::<MyResponse>()
           .await
           .map_err(|e| format!("Parse failed: {e}"))
   }
   ```

3. Register in `src-tauri/src/bindings.rs`:
   ```rust
   Builder::<tauri::Wry>::new().commands(collect_commands![
       // existing commands...
       my_api::fetch_data,
   ])
   ```

4. Regenerate bindings: `pnpm run rust:bindings`

5. Call from the frontend:
   ```ts
   const data = unwrapResult(await commands.fetchData('my query'))
   ```

## Auth token storage

Three options, from most to least secure:

### `keyring` crate (recommended)

Stores tokens in the OS keychain (macOS Keychain, Windows Credential Manager,
Linux Secret Service).

```toml
keyring = { version = "3", features = ["apple-native", "windows-native", "sync-secret-service"] }
```

```rust
#[tauri::command]
#[specta::specta]
pub fn store_token(service: String, token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, "default")
        .map_err(|e| format!("Keyring error: {e}"))?;
    entry.set_password(&token)
        .map_err(|e| format!("Storing token: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn get_token(service: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(&service, "default")
        .map_err(|e| format!("Keyring error: {e}"))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Reading token: {e}")),
    }
}
```

### `tauri-plugin-stronghold`

Encrypted file-based storage. Heavier than `keyring` but does not depend on
an OS keychain daemon. Suitable when the Linux Secret Service is not
guaranteed to be available.

### `tauri-plugin-store` (NOT for secrets)

JSON file storage — the same mechanism the template uses for preferences. Fine
for non-sensitive data, but tokens are stored in plaintext. Do not use for
auth secrets.

### Comparison

| | `keyring` | `stronghold` | `store` |
| --- | --- | --- | --- |
| Encryption | OS-managed | App-managed | None |
| Requires daemon | Yes (Linux) | No | No |
| Binary cost | Small | Moderate | Already included |
| Good for secrets | Yes | Yes | No |

## Offline-caching pattern

For data that should be available offline:

1. The Rust command fetches from the API
2. On success, writes the response to `<app-data-dir>/cache/<key>.json` using
   the same `save_json()` pattern from `json_store.rs` (atomic temp+rename)
3. On network failure, reads and returns the cached file via `load_json()`
4. The frontend sees the same typed response either way

This keeps the caching logic entirely in Rust — the frontend does not need to
know whether the data came from the network or disk.
