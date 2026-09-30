# External APIs

This doc covers making HTTP requests and storing auth tokens. Ostralith is
offline by default, so read [Privacy & Network](privacy.md) first: it
describes the policy every request below is subject to.

## Requests are made in Rust, through `NetClient`

The webview never makes network requests. `fetch`, `XMLHttpRequest`,
`WebSocket` and `EventSource` are rejected by the `no-fetch` ast-grep rule
(`.ts`) and ESLint `no-restricted-globals` (`.svelte`), and the CSP limits
`connect-src` to IPC. In Rust, `clippy.toml` forbids building a `reqwest`
client or opening a socket anywhere but `crates/net`.

| Consideration | Why Rust + `NetClient` |
| --- | --- |
| Offline mode | Enforced in one place; a blocked request returns `CoreError::Offline` |
| Visibility | Every attempt is logged, with its purpose, in Preferences → Privacy & Network |
| CORS | Not subject to CORS |
| Secrets | Tokens stay in the Rust process (and the OS keychain) |

## Adding a Rust HTTP command

1. Put the command in a domain module (e.g. `src-tauri/src/commands/my_api.rs`)
   and take the managed client as state. Do **not** add `reqwest` to the app
   crate or build a client of your own:
   ```rust
   use ostralith_core::CoreError;
   use ostralith_net::NetClient;
   use tauri::State;

   #[tauri::command]
   #[specta::specta]
   pub async fn fetch_data(
       net: State<'_, NetClient>,
       query: String,
   ) -> Result<MyResponse, CoreError> {
       let mut url = url::Url::parse("https://api.example.com/search")
           .map_err(|e| CoreError::Internal { message: e.to_string() })?;
       url.query_pairs_mut().append_pair("q", &query);
       let resp = net.get(url.as_str(), "example-search").await?;
       resp.json::<MyResponse>().await.map_err(|e| CoreError::Network {
           message: e.to_string(),
       })
   }
   ```
   `?` on a `NetError` converts it into `CoreError::Offline`,
   `HostNotAllowed` or `Network`. The query string is stripped from the
   activity log automatically, but still keep secrets in headers, not URLs.

2. Register it in `src-tauri/src/bindings.rs`:
   ```rust
   Builder::<tauri::Wry>::new().commands(collect_commands![
       // existing commands...
       my_api::fetch_data,
   ])
   ```

3. Regenerate bindings: `pnpm run rust:bindings`

4. Call it from the frontend, and disable the entry point while offline:
   ```ts
   import { commands } from '$lib/tauri-bindings'
   import { describeError } from '$lib/core-error'
   import { isOffline } from '$lib/stores/network.svelte'

   // In the component: <Button disabled={isOffline()}>…</Button>
   const result = await commands.fetchData('my query')
   if (result.status === 'error') toast.error(describeError(result.error))
   ```

If a library brings its own HTTP client (the updater plugin, libgit2), call
`net.authorize_external(method, url, purpose)?` before handing it the URL.

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

Plain JSON file storage (Ostralith's own preferences use the similar
`json_store.rs`, not this plugin). Fine for non-sensitive data, but tokens are stored in plaintext. Do not use for
auth secrets.

### Comparison

| | `keyring` | `stronghold` | `store` |
| --- | --- | --- | --- |
| Encryption | OS-managed | App-managed | None |
| Requires daemon | Yes (Linux) | No | No |
| Binary cost | Small | Moderate | Small |
| Good for secrets | Yes | Yes | No |

## Offline-caching pattern

For data that should be available offline:

1. The Rust command fetches from the API through `NetClient`
2. On success, writes the response to `<app-data-dir>/cache/<key>.json` using
   the same `save_json()` pattern from `json_store.rs` (atomic temp+rename)
3. On network failure, **or when offline mode blocks the request**, reads and
   returns the cached file via `load_json()`
4. The frontend sees the same typed response either way

This keeps the caching logic entirely in Rust — the frontend does not need to
know whether the data came from the network or disk.
