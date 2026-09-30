# Workspace: Tabs, Views & URIs

The centre of the main window is a tabbed workspace instead of a router.
Every tab is identified by an `ostralith://` URI, rendered by a view looked up
by the tab's `kind`, and persisted in `state.json` so the strip survives a
restart. Phase 0 ships the shell only: with no vault yet, the workspace shows
the "No vault" empty state, and unknown tab kinds render a placeholder.

```
src/lib/workspace/
  uri.ts                  parseUri / formatUri for ostralith:// URIs
  tabs.svelte.ts          Tab + editor-group store, persistence, quit gate
  view-registry.ts        tab kind → lazily imported component
  deep-link-router.ts     routeDeepLink(url): URI → tab, dialog or toast
src/lib/components/workspace/
  EditorArea.svelte       Centre pane: groups side by side, or EmptyWorkspace
  EditorGroup.svelte      One group: TabBar + the active tab's view
  TabBar.svelte           Tab strip (pin, dirty dot, close, middle-click)
  EmptyWorkspace.svelte   "No vault" state with palette/preferences hints
  UnknownView.svelte      Fallback for a kind with no registered view
src/lib/commands/tab-commands.ts   tab.* commands and their shortcuts
```

## URIs

`src/lib/workspace/uri.ts` is shared by tabs and deep links
(`DEEP_LINK_SCHEME` in `src/lib/deep-link.ts`).

| Form | Target |
| --- | --- |
| `ostralith://note/<path>[#heading]` | A vault-relative note. Each path segment is percent-encoded. |
| `ostralith://view/<viewId>` | A built-in view, e.g. `settings.privacy` |
| `ostralith://search?q=<query>` | A search (not available until P1) |

- `parseUri(raw)` returns a `WorkspaceTarget` or `null`. The scheme and kind
  are case-insensitive; everything after them is case-preserving.
- Note paths are validated because they will name files on disk: empty or
  dot segments, absolute paths, Windows drive letters, backslashes, encoded
  slashes and control characters (including NUL) are all rejected. URIs are
  capped at `MAX_TAB_URI_LEN` (4096 bytes).
- `formatUri(target)` produces the **canonical** form. Tabs are de-duplicated
  by canonical URI, so always build URIs with `formatUri` rather than string
  concatenation.

The Rust vault layer (P1) re-validates every path with canonicalised
containment; the frontend check is a first filter, not the security boundary.

## Tabs store

`src/lib/workspace/tabs.svelte.ts` holds `Tab { id, kind, uri, title, dirty,
pinned, preview }` inside editor groups. There is one group (`main`) today,
but every operation is written against "the group that holds this tab", so
splits can arrive without reshaping the store.

| Function | Notes |
| --- | --- |
| `initTabs(appState)` | Restores `openTabs` / `activeTabId`. Nothing is persisted before this runs. |
| `openTab({ kind, uri, title }, options?)` | Focuses an existing tab with the same URI, otherwise opens one. Options: `preview`, `background`, `pinned`. |
| `closeTab(id)` | Asks through `confirm()` if the tab is dirty. Returns whether it closed. |
| `closeOtherTabs`, `reopenClosedTab`, `nextTab`, `prevTab`, `moveTab` | Closed history keeps the last 20 tabs. |
| `pinTab`, `unpinTab`, `togglePinTab` | Pinned tabs always sit first in their group. |
| `keepTab(id)` | Turns a preview tab into a normal one. |
| `setTabDirty(id, dirty)` | Feeds the quit gate (see below). |
| `setTabTitle(id, title)` | |

**Preview tabs.** A tab opened with `preview: true` is replaced by the next
preview open in its group until it is kept (edited, pinned or opened again
normally), like single-click in VS Code.

**Persistence.** Tabs are stored in `PersistedAppState.openTabs`
(`PersistedTab { id, kind, uri, title, pinned }`) and `activeTabId`, written
through `setAppStateField` in the app-state store. The tabs store has no
writer of its own: two writers of one `state.json` would race. Saves are
debounced and drained by `flushAllStores()` on quit. `dirty` and `preview` are
session-only. Limits (`MAX_OPEN_TABS` = 100, kind 64 bytes, title 512 bytes)
are mirrored in `src-tauri/src/types.rs` and validated on both sides; see
[State Management](state-management.md).

**Quit gate.** Dirty tabs register the `tabs` source with
`src/lib/stores/dirty.svelte.ts`, so the existing unsaved-changes handshake
([Error Handling](error-handling.md)) covers them on every exit path.

## Views

`src/lib/workspace/view-registry.ts` maps a tab `kind` to a lazily imported
component:

```ts
import { registerView } from '$lib/workspace/view-registry'

const unregister = registerView({
  kind: 'note',
  component: () => import('$lib/components/editor/NoteView.svelte'),
  titleKey: 'views.note.title',
  icon: FileTextIcon,
})
```

- Components receive `ViewProps` (`{ tab, groupId }`).
- The first registration of a kind wins; `registerView` returns an
  unregister function (plugins will use it on deactivate).
- `resolveView(kind)` / `loadView(kind)` fall back to the `unknown` view
  (`UnknownView.svelte`) for unregistered kinds. Loads are cached per
  definition, and a failed import is evicted from the cache and falls back,
  so a broken view never takes the workspace down.

No views are registered in Phase 0. The note editor (P1) and plugin views
(P3) are the first callers.

## Deep links

`routeDeepLink(url)` in `src/lib/workspace/deep-link-router.ts` handles every
URL from the `app:deep-link-received` event (see
[Cross-Platform](cross-platform.md#deep-linking-ostralith-scheme)):

| URL | Result |
| --- | --- |
| `note/<path>[#heading]` | Opens or focuses the note's tab. The heading is ignored for de-duplication. |
| `view/settings` | Opens Preferences on its current pane |
| `view/settings.<pane>` | Opens Preferences on `general`, `appearance`, `shortcuts`, `privacy`, `advanced` or `about` |
| `view/<id>` | Opens a tab of kind `view:<id>` |
| `search?q=` | Info toast: search arrives with vaults (P1) |
| anything invalid | Warning toast, nothing opened |

The settings pane list is typed as `Record<PreferencesPaneId, true>`, so
adding a Preferences pane without making it deep-linkable is a type error.
A link that arrives before `initTabs` runs is kept and merged into the
restored strip.

## Tab commands

Registered in `src/lib/commands/tab-commands.ts` (category "Tabs"):

| Command | Default |
| --- | --- |
| `tab.close` | `mod+w` |
| `tab.closeOthers` | — |
| `tab.next` / `tab.prev` | `mod+alt+arrowright` / `mod+alt+arrowleft` |
| `tab.reopenClosed` | `mod+shift+t` |
| `tab.togglePin` | — |

`mod+w` is deliberately **not** on the OS-reserved list: it is the built-in
tab-close default. See [Commands & Shortcuts](commands-and-shortcuts.md).
