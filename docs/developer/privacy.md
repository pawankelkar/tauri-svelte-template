# Privacy & Network

Ostralith is local-first: notes, indexes and models stay on the machine, and
the app makes **no network calls unless the user turns offline mode off**. This
doc covers how that promise is enforced, how to make a request when a feature
genuinely needs one, and how Pro features are gated.

## The rule

Every outbound request goes through **one** Rust client,
`ostralith_net::NetClient` (`src-tauri/crates/net`). Nothing else in the app
may open a connection:

| Layer | Enforcement |
| --- | --- |
| Rust | `src-tauri/clippy.toml` disallows `reqwest::Client::new`, `reqwest::Client::builder`, `reqwest::ClientBuilder::new`, `reqwest::get`, `std::net::TcpStream::connect` and `connect_timeout`. Only `crates/net` opts back in, with a scoped `#[allow(clippy::disallowed_methods)]`. |
| Frontend `.ts` | ast-grep rule `.ast-grep/rules/no-fetch.yml` rejects `fetch`, `window.fetch`, `globalThis.fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource`. |
| Frontend `.svelte` | ESLint `no-restricted-globals` covers the same names (ast-grep does not parse Svelte). |
| Webview | CSP `connect-src 'self' ipc: http://ipc.localhost`, `img-src 'self' data: blob: asset: http://asset.localhost`, `object-src 'none'`. Even a missed `fetch` cannot leave the machine. |
| Third-party HTTP stacks | Code that cannot use `NetClient` (the updater plugin, later libgit2) must call `NetClient::authorize_external` first. See [below](#third-party-http-stacks). |

There is no telemetry. Crash reports and diagnostics bundles are written to
disk and only leave the machine if the user sends them (see
[Error Handling](error-handling.md)).

## `NetPolicy`

The policy lives in `crates/net/src/policy.rs` and is persisted as
`network.json` in the app data directory.

| Field | Default | Meaning |
| --- | --- | --- |
| `offline` | `true` | Block every non-loopback host. A missing or corrupt `network.json` also means offline. |
| `allowLocalhost` | `true` | Allow loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, v4-mapped loopback) even when offline, for local model servers such as LM Studio or a sidecar. LAN addresses are **not** loopback. |
| `allowedHosts` | `["*"]` | When online, hosts must match an entry: an exact host, `*.suffix` (subdomains only, not the bare suffix) or `*`. |

`NetPolicy::check(url)` decides, in order:

1. Only `http` and `https` are accepted (`UnsupportedScheme` otherwise).
2. Loopback with `allowLocalhost` on is allowed.
3. Offline blocks everything else (`Offline { host }`).
4. Online, the host must match `allowedHosts` (`HostNotAllowed { host }`).

With `allowLocalhost` off, loopback hosts are treated like any other host.

## `NetClient`

`NetClient` is managed Tauri state, built from the saved policy in `setup()`
by `commands::network::init_network`. It wraps a single `reqwest::Client`
(rustls, user agent `Ostralith/<version>`).

```rust
use ostralith_net::NetClient;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn fetch_model_card(net: State<'_, NetClient>, url: String) -> Result<String, CoreError> {
    let response = net.get(&url, "model-card").await?;
    Ok(response.text().await.map_err(|e| CoreError::Network { message: e.to_string() })?)
}
```

- **Every request carries a purpose** (`"updater"`, `"model-download"`, …). It
  shows up in the activity log so the user can see _why_ the app went online.
- `get(url, purpose)` and `send(request, purpose)` check the policy, log the
  attempt and perform it. Build custom requests with `new_request(method, url)`.
- `check(url)` is a pre-flight: it applies the policy without logging.
- **Redirects are re-checked.** A custom redirect policy runs every hop
  (maximum 10) through the policy, so an allowed host cannot bounce a request
  to a blocked one. A blocked hop is logged with purpose `redirect`.
- `set_offline` / `set_policy` swap the live policy. The app commands persist
  first, then apply (see below).

Policy errors convert into `CoreError::Offline` / `CoreError::HostNotAllowed`,
which the frontend renders with `describeCoreError()` in `src/lib/core-error.ts`.

### Third-party HTTP stacks

Some libraries bring their own HTTP client. Before handing them a URL, ask
the policy:

```rust
net.authorize_external("GET", endpoint, "updater")?;
```

This applies offline mode and the allowlist and records the attempt as
`Sent` or `Blocked`. It checks **only the URL you pass**: redirects inside the
library's own client are not re-checked, so only use it for endpoints you
control.

`commands/updater.rs` is the reference: `check_for_update` authorizes every
configured `plugins.updater.endpoints` entry, and `install_update` authorizes
the download URL, before the plugin does any I/O. With no endpoint configured
the commands return `FeatureDisabled`. Checks only happen when the user clicks
**Check for updates** in Preferences → About, and those buttons are disabled
while offline.

## Activity log

Each attempt becomes a `RequestRecord`:

| Field | Notes |
| --- | --- |
| `timestampMs`, `method`, `host`, `purpose` | |
| `url` | Redacted: query string, fragment and credentials are stripped before logging. |
| `outcome` | `sent` or `blocked` |
| `status`, `bytes`, `error` | Filled in when known. |

The log is in memory only (never written to disk), capped at 500 records, and
cleared on restart or by the user.

## Commands and events

`src-tauri/src/commands/network.rs`:

| Command | Purpose |
| --- | --- |
| `get_network_status` | Current `NetPolicy` |
| `set_offline_mode(offline)` | Persist then apply |
| `set_allow_localhost(allow)` | Persist then apply |
| `list_network_activity` | Records, newest first |
| `clear_network_activity` | Empty the log |

Updates are serialised by a write lock and persisted **before** they are
applied, so the live policy never disagrees with what survives a restart.
Every change emits `network:policy-changed` with the new policy, so all
windows follow without polling.

Frontend: `src/lib/stores/network.svelte.ts` (`initNetwork`, `isOffline`,
`setOffline`, `setAllowLocalhost`, `loadActivity`, `clearActivity`) mirrors
the policy and keeps the `offline` [context key](commands-and-shortcuts.md)
up to date, so commands can use `when: '!offline'`. The UI is Preferences →
**Privacy & Network** (`PrivacyPane.svelte`, deep link
`ostralith://view/settings.privacy`).

## Pro features (local flags)

Pro features are **local flags with no licence server and no network check**.
A flag is on because the user (or a build) switched it on.

- `ProFeature` and `Entitlements` live in `crates/core` (`realtimeTranslation`,
  `pdfAiQa`, `premiumCloudModels`). Unknown ids in the file are dropped on load.
- `commands/entitlements.rs` persists them as `entitlements.json` and exposes
  `get_entitlements` / `set_entitlement`, emitting `entitlements:changed`.
- Every Pro command guards itself in Rust before doing work:

  ```rust
  entitlements::require(&state, ProFeature::PdfAiQa)?; // CoreError::NotEntitled
  ```

- `src/lib/stores/entitlements.svelte.ts` (`isEntitled`, `setEntitlement`)
  mirrors the flags and sets the `pro` context key. `ProBadge.svelte` marks Pro
  UI and shows a locked style while its feature is off.

The frontend check is for presentation only; the Rust guard is the one that
counts.

## Checklist for a feature that needs the network

1. Do the request in Rust through `State<NetClient>`, with a descriptive
   purpose string.
2. Return `CoreError` so offline and blocked hosts render consistently.
3. Hide or disable the entry point while offline (`isOffline()` or
   `when: '!offline'`), and say why.
4. Never start a request on launch or in the background without a user action
   or an explicit opt-in.
5. For a library with its own client, call `authorize_external` first.
