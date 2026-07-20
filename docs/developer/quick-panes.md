# Quick Panes

The Quick Pane is a small always-on-top window opened by a global shortcut —
`Ctrl/Cmd+Shift+.` out of the box — that works even while another application
has focus. It takes one line of text and hands it to the main window.

It exists in this template as the worked example of **multi-window Tauri**:
a second Vite entry point, an independent Svelte context, cross-window events,
per-window capabilities, and a second global accelerator. Everything below
generalises to any auxiliary window you need.

---

## Why two windows means two of everything

A Tauri window is a webview, and a webview is a separate JavaScript context.
The Quick Pane cannot import the main window's stores, read its `$state`, or
call its functions — those objects live in a different process-level runtime.

What the two windows _do_ share is an **origin** (`tauri://localhost`, or
`http://localhost:1420` in dev). That gives them a common `localStorage`, which
is why the theme hint works across both without any message passing.

Everything else crosses the boundary as a Tauri event.

| Concern              | How it crosses                                                      |
| -------------------- | ------------------------------------------------------------------- |
| Theme                | `localStorage['ui-theme']` + a `theme-changed` event as the trigger |
| Submitted text       | `quick-pane-submit` event, payload `{ text: string }`               |
| Show / hide / toggle | Rust commands, never `window.hide()` from JS                        |

---

## The build: two entry points

The pane is its own HTML document, so Rollup needs to know about it:

```ts
// vite.config.ts
build: {
  rollupOptions: {
    input: {
      main: path.resolve(__dirname, 'index.html'),
      'quick-pane': path.resolve(__dirname, 'quick-pane.html'),
    },
  },
},
```

Dev needs no configuration — Vite already serves `/quick-pane.html` from the
project root, which is exactly where `WebviewUrl::App("quick-pane.html")`
resolves.

The three files that make up the entry:

- `quick-pane.html` — the shell, mounting into `#quick-pane-app`
- `src/quick-pane-main.ts` — `paintFromHint()` then `mount(QuickPaneApp)`,
  mirroring `src/main.ts`
- `src/quick-pane.css` — imports `app.css` for the design tokens, then forces
  `html`, `body` and `#quick-pane-app` to `background: transparent`

That last file matters more than it looks. The pane's window is transparent and
undecorated; the visible card is drawn by the component. If any layer above it
stays opaque, the rounded corners get squared off and the drop shadow falls on
nothing.

---

## The window

`init_quick_pane()` in `src-tauri/src/commands/quick_pane.rs` builds it once,
hidden, from `setup()`:

```rust
WebviewWindowBuilder::new(app, "quick-pane", WebviewUrl::App("quick-pane.html".into()))
    .inner_size(640.0, 84.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .visible(false)
    .build()
```

It is a plain function rather than a `#[tauri::command]` on purpose: window
creation must run on the main thread, and nothing in the frontend has any
business building a second one.

Failure is logged and swallowed. The app is entirely usable without the pane,
so a window-creation error must not abort startup.

### Positioning

`show_quick_pane` places the pane on **the monitor the cursor is on**, not the
monitor the main window happens to occupy:

```
app.cursor_position() → app.monitor_from_point(x, y) → fall back to primary_monitor()
```

Each step is allowed to fail — on an unusual display setup the pane should open
somewhere reasonable rather than refuse to open. The arithmetic itself lives in
a pure `centered_position()` helper so the parts that actually go wrong (a
secondary monitor with a negative origin, a 2× HiDPI scale factor) are covered
by unit tests instead of by manual dragging.

The pane sits horizontally centred and 25% down the monitor. Dead centre reads
as a modal dialog; slightly high is the placement people already know from
Spotlight and similar launchers.

### Window state

`quick-pane` is in the `tauri_plugin_window_state` denylist (`lib.rs`). The
pane's position is computed on every show, so persisting it would be pointless
at best — and on macOS, if you later adopt NSPanel, `is_maximized()` on a panel
crashes.

---

## Dismissal

Every dismissal path calls the **`dismiss_quick_pane` command**, never
`getCurrentWindow().hide()`:

- blur (`onFocusChanged` with `focused === false`)
- Escape
- submit

Routing them all through Rust means the visibility guard lives in exactly one
place. That guard matters because hiding can itself trigger a blur, so
`dismiss` gets called twice for a single user action; the `is_visible()` check
makes the second call a no-op.

Escape calls `preventDefault()` before dismissing. Without it, macOS plays the
system alert sound for an Escape the webview did not consume.

---

## Capabilities

`src-tauri/capabilities/quick-pane.json` is scoped to `"windows": ["quick-pane"]`
and grants only `core:default`, a few `core:window:*` permissions, and
`core:event:default` / `core:event:allow-emit`.

It does **not** need permissions for showing and hiding — those go through
app-defined Rust commands, and app-defined commands are not permission-gated.
Only core and plugin commands are. The same reasoning is why the global-shortcut
plugin needs no `global-shortcut:*` entry anywhere in this template.

---

## The shortcut

Two global accelerators are now registered, and the plugin installs a _single_
handler for all of them — so the handler has to work out which one fired.

`src-tauri/src/commands/global_shortcut.rs` keeps a registry keyed by purpose:

```rust
static SHORTCUTS: LazyLock<Mutex<HashMap<ShortcutPurpose, String>>>
```

`ShortcutPurpose` (`focusMain` | `quickPane`) is a specta type, so the same
identifiers appear on both sides of the IPC boundary. Dispatch compares
**parsed** `Shortcut` values rather than strings — the stored spelling
(`CmdOrCtrl+Shift+.`) and whatever the OS reports need not match textually, but
both parse to the same modifiers-plus-key value.

Adding a third global shortcut is a variant on `ShortcutPurpose`, an arm in the
handler, and two lines in the `PURPOSES` table in `commit-shortcut.ts`. No new
command, no new picker component.

### The default binding

`DEFAULT_QUICK_PANE_SHORTCUT` in `src-tauri/src/types.rs` is materialised
through `AppPreferences::default()`. Because the struct carries
`#[serde(default)]`, this gives three distinguishable states:

| `preferences.json`                 | Meaning                                      |
| ---------------------------------- | -------------------------------------------- |
| key absent                         | Never configured → the default is registered |
| `"quickPaneShortcut": "Alt+Space"` | User's own binding                           |
| `"quickPaneShortcut": null`        | User cleared it → nothing is registered      |

That third row is the reason the default lives in `Default::default()` rather
than in an `unwrap_or` at the call site: an `unwrap_or` would hand the default
back to a user who deliberately cleared the binding.

### Rebinding

Preferences → General → Quick Pane Shortcut. `commitShortcut()` handles the
register-then-persist sequence with rollback on either failure, so the user can
never end up with a shortcut that works but isn't saved, or is saved but
doesn't work.

Assigning the _same_ combination to both purposes fails at OS registration and
surfaces as an error toast, leaving the previous binding intact. There is no
special-case check for it — the general failure path already does the right
thing.

---

## Platform behaviour

|                                  | macOS | Windows | Linux (X11) | Linux (Wayland)         |
| -------------------------------- | ----- | ------- | ----------- | ----------------------- |
| Always on top                    | ✅    | ✅      | ✅          | ✅                      |
| Hidden from taskbar/dock         | ✅    | ✅      | ✅          | ✅                      |
| Follows the cursor's monitor     | ✅    | ✅      | ✅          | ⚠️ compositor-dependent |
| Visible across Spaces/workspaces | ✅    | n/a     | ✅          | ⚠️                      |
| Appears over a fullscreen app    | ❌    | ✅      | ⚠️          | ⚠️                      |
| Opens without stealing focus     | ❌    | ✅      | ✅          | ⚠️                      |
| Global shortcut                  | ✅    | ✅      | ✅          | ❌ often blocked        |

Two caveats worth knowing before you ship:

**Wayland** does not let applications register global shortcuts through the
usual route; most compositors require a portal or a desktop-environment
keybinding. The pane still works, but its accelerator may never fire. The
command palette entry (`Toggle Quick Pane`) is the fallback.

**Backdrop blur** is CSS `backdrop-filter`, not the platform's native material.
It looks close enough on all three, but it is not vibrancy.

---

## Optional: NSPanel on macOS

The two ❌s in the macOS column above are inherent to a normal window. Showing
it activates the application, which on macOS can drag the user to whichever
Space the main window is on — the exact thing a quick-capture panel must not
do. A native `NSPanel` fixes both.

This template does **not** ship it, for two reasons: `tauri-nspanel` is only
distributed as a git dependency (no crates.io release, no semver), and a
template's macOS path should not be code its author cannot test. If you are
building a macOS-first app, the upgrade is contained. Here is the whole of it.

**1. Dependency** — `src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri-nspanel = { git = "https://github.com/ahkohd/tauri-nspanel", branch = "v2.1" }
```

`macos-private-api` is already enabled on the `tauri` dependency, and
`macOSPrivateApi: true` is already set in `tauri.conf.json`.

**2. Plugin** — in `lib.rs`, alongside the other plugins:

```rust
#[cfg(target_os = "macos")]
{ app_builder = app_builder.plugin(tauri_nspanel::init()); }
```

**3. Panel class and builder** — replace the macOS arm of `init_quick_pane`:

```rust
tauri_panel! {
    panel!(QuickPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

PanelBuilder::<_, QuickPanel>::new(app, "quick-pane")
    .url(WebviewUrl::App("quick-pane.html".into()))
    .level(PanelLevel::Status)      // above fullscreen windows
    .nonactivating(true)            // show without activating the app
    .can_join_all_spaces(true)
    .transparent(true)
    .shadow(true)
    .works_when_modal(true)
    .build()?;
```

**4. Dismissal order** — this is the part that is easy to get wrong. In
`dismiss_quick_pane`, call `resign_key_window()` **before** `hide()`:

```rust
if panel.is_visible() {
    panel.resign_key_window();   // must come first
    panel.hide();
}
```

Hiding a key window without resigning first makes macOS activate the next
window in line — the main window — and if that window lives on another Space,
the user gets yanked across. Resigning first leaves focus where the user put it.

**5. Teardown** — in the `RunEvent::Exit` arm, hide the panel before the app
tears down, or the panel outlives its webview and crashes:

```rust
#[cfg(target_os = "macos")]
if let Ok(panel) = app_handle.get_webview_panel("quick-pane") { panel.hide(); }
```

---

## Making it your own

The pane's content is `src/lib/components/quick-pane/QuickPaneApp.svelte` and
nothing outside it assumes a single text input. To turn it into something else:

1. Replace the component's body. It has the full design-token set, `t()`, and
   the shadcn primitives available — it is an ordinary Svelte app.
2. Change the event payload in `src/lib/quick-pane/events.ts`. Both windows
   import the event name and payload type from there, so a rename cannot leave
   one side listening for a string the other no longer emits.
3. Change what the main window does with it in `applyQuickPaneEntry()`
   (`src/lib/quick-pane/bridge.ts`). It currently records the text in app state
   and toasts; that function is where your own handling goes.
4. Resize the window with `WIDTH` / `HEIGHT` in `quick_pane.rs`. The pure
   positioning helper picks the change up automatically.

If you don't want a Quick Pane at all, deleting it is clean: remove
`quick_pane.rs` and its `collect_commands!` entries, the `QuickPane` variant of
`ShortcutPurpose`, the `quick-pane` Vite input, the three `quick-pane*` frontend
files, and `capabilities/quick-pane.json`.
