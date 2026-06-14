# 02 — PluginAPI reference

Complete reference for the object your plugin receives in `install(app, api)` and stores as
`this.api`. Source of truth: `api/web/plugin.ts` in the CloudTAK repo (verified against
**13.14.1**). Import types from `@tak-ps/cloudtak`.

```ts
import type { PluginAPI, PluginInstance, MenuItemConfig,
              BottomBarItemConfig, FloatingPane, DBFeature } from '@tak-ps/cloudtak';
```

---

## The `PluginInstance` / `PluginStatic` contract

```ts
export interface PluginStatic {
    // Called once at startup. Set up routes/clients here. Return the instance.
    install(app: App, api: PluginAPI): PluginInstance | Promise<PluginInstance>;
}

export interface PluginInstance {
    // Called when the user/server has the plugin enabled and the map is ready. Add UI here.
    enable(): Promise<void>;
    // Called to remove ALL user-facing functionality. Remove the UI here (not routes).
    disable(): Promise<void>;
}
```

Your default export is a class implementing `PluginInstance` with a `static install`. See the
lifecycle rules in [`01-architecture.md`](01-architecture.md#the-lifecycle-web-half) and
`AGENTS.md` §2.

---

## `PluginAPI` top-level

| Member | Type | Notes |
|--------|------|-------|
| `api.app` | `App` (Vue) | The root Vue app instance. |
| `api.router` | `Router` (vue-router) | The app router. Prefer `api.routes.add`. |
| `api.pinia` | `Pinia` | The store instance. Rarely needed directly. |
| `api.menu` | `{ add, remove }` | Main (right-side) menu. |
| `api.routes` | `{ add }` | Register vue-router routes. |
| `api.map` | `maplibre-gl.Map` | The live MapLibre map. |
| `api.feature` | `{ list, stream }` | Read/observe features in the local CoT DB. |
| `api.breadcrumb` | `{ live: { add, remove, list } }` | Per-UID breadcrumb-trail recording. |
| `api.float` | `{ add, remove, has }` | Floating panes over the map. |
| `api.bottomBar` | `{ add, remove }` | Widgets in the centre of the status bar. |

Each getter pulls the relevant Pinia store on access, so always go through `api.*` rather than
caching a sub-object across a map reload.

---

## `api.menu` — the main menu

```ts
api.menu.add(item: MenuItemConfig): void   // validates route exists unless routeExternal
api.menu.remove(key: string): void         // safe if not present / map not loaded
```

`add` warns and bails if `item.route` isn't a registered route (and `routeExternal` is
falsy) — **register the route first** (`AGENTS.md` R2). Your menu item appears at the bottom of
the right-side menu.

### `MenuItemConfig` schema

| Field | Type | Req | Meaning |
|-------|------|-----|---------|
| `key` | `string` | ✓ | Unique id; the handle for `remove`. Namespace it: `plugin-<name>`. |
| `label` | `string` | ✓ | Display text in the menu list. |
| `route` | `string` | ✓ | Route **name** to navigate to (or external URL if `routeExternal`). |
| `routeExternal` | `boolean` | | If true, `route` is an external URL; skips the route-exists check. |
| `tooltip` | `string` | ✓ | Hover tooltip. |
| `description` | `string` | | Sub-text shown in tile/expanded layouts. |
| `icon` | `Component` | ✓ | A Vue component — typically a Tabler icon. **`markRaw` it.** |
| `badge` | `string` | | Small badge text (e.g. a count). |
| `visibility` | `string` | | Visibility hint (see core menu module for accepted values). |
| `requiresSystemAdmin` | `boolean` | | Only show to system admins. |
| `requiresAgencyAdmin` | `boolean` | | Only show to agency admins. |

```ts
import { markRaw } from 'vue';
import { IconHeadset } from '@tabler/icons-vue';

api.menu.add({
    key:         'plugin-tak-dispatcher',
    label:       'Dispatcher',
    route:       'home-menu-tak-dispatcher',
    tooltip:     'CloudTAK Dispatcher',
    description: 'Dispatch incidents on the map',
    icon:        markRaw(IconHeadset),
});
```

---

## `api.routes` — vue-router routes

```ts
api.routes.add(route: RouteRecordRaw, parentName?: string): void
```

- No-ops if a route with the same `name` already exists (safe to call repeatedly).
- Pass `parentName` to nest under an existing route. CloudTAK menu panels are nested under
  **`'home-menu'`** so they render in the right-side menu drawer.
- The `component` you pass becomes the panel. `markRaw`/async-import as appropriate.

```ts
api.routes.add(
    { path: 'tak-dispatcher', name: 'home-menu-tak-dispatcher', component: CadMain },
    'home-menu'
);
```

> Do this in `install()`, once. Never remove routes in `disable()` (`01-architecture.md`).

---

## `api.map` — the MapLibre map

```ts
const map: maplibregl.Map = api.map;   // full MapLibre GL JS API
```

The live map. You *can* call raw MapLibre (`flyTo`, `getBounds`, event listeners). **But for
placing TAK data, do not hand-roll layers/sources** — go through the worker DB (below /
`05-recipes.md`) so your markers are real CoT and participate in DataSync, persistence, and
the rest of CloudTAK. Use `api.map` for camera/inspection, the feature DB for data.

---

## `api.feature` — the local CoT feature database

Read and reactively observe the features currently in the client's local DB (CoT markers,
drawings, etc). `DBFeature` is exported from `@tak-ps/cloudtak`.

```ts
// One-shot snapshot:
api.feature.list(opts?: { filter?: (f: DBFeature) => boolean }): Promise<DBFeature[]>

// Reactive stream (RxJS Observable, backed by Dexie liveQuery) — re-emits on every change:
api.feature.stream(opts?: { filter?: (f: DBFeature) => boolean }): Observable<DBFeature[]>
```

```ts
const sub = api.feature
    .stream({ filter: (f) => f.properties?.type?.startsWith('a-h') })  // hostile tracks
    .subscribe((hostiles) => { /* update your panel */ });
// remember to sub.unsubscribe() in disable()
```

> `list`/`stream` are **read** APIs. To *create/update/remove* a feature, write a CoT through
> the worker DB (`05-recipes.md`, "Drop a CoT marker").

---

## `api.breadcrumb` — live breadcrumb trails

Toggle server-side breadcrumb-trail recording for a CoT by UID.

```ts
api.breadcrumb.live.add(uid: string): Promise<void>      // start recording a trail
api.breadcrumb.live.remove(uid: string): Promise<void>   // stop
api.breadcrumb.live.list(): Promise<string[]>            // UIDs currently recording
```

---

## `api.float` — floating panes over the map

Draggable/resizable windows that float above the map (independent of the menu drawer).

```ts
api.float.add(opts: {
    uid: string;                       // unique id; handle for remove/has
    name?: string;                     // window title
    component: Component;              // body component (markRaw internally)
    actions?: Component;              // optional header actions component
    props?: Record<string, unknown>;  // props passed to your component
    height?: number; width?: number;  // initial size (px)
    x?: number; y?: number;            // initial position (px)
}): FloatingPane

api.float.remove(uid: string): void
api.float.has(uid: string): boolean
```

`FloatingPane` (returned/queryable): `{ uid, name?, component, config, height, width, x, y }`.
Use `has(uid)` to avoid double-adding the same pane.

---

## `api.bottomBar` — status-bar widgets

Add a component to the **centre of the map's bottom status bar** (added in a recent CloudTAK
release — confirm it exists in your target version's `plugin.ts`).

```ts
api.bottomBar.add(item: BottomBarItemConfig): void   // { key, component }
api.bottomBar.remove(key: string): void
```

### `BottomBarItemConfig` schema

| Field | Type | Req | Meaning |
|-------|------|-----|---------|
| `key` | `string` | ✓ | Unique id; handle for `remove`. Duplicate keys are skipped with a warn. |
| `component` | `Component` | ✓ | Rendered in the centre of the status bar (`markRaw` internally). |

---

## Quick map: "I want to…" → API

| Goal | Use |
|------|-----|
| Add a panel reachable from the menu | `routes.add` (install) + `menu.add` (enable) |
| Show a draggable window over the map | `float.add` / `float.remove` |
| Put a live widget in the status bar | `bottomBar.add` / `bottomBar.remove` |
| React to CoT data on the map | `feature.stream` (or `feature.list`) |
| Move/inspect the camera | `api.map` (MapLibre) |
| Record a track's trail | `breadcrumb.live.add` |
| Place / update / remove a CoT marker | worker DB — `05-recipes.md` |
| Call your own backend | `std()` → your `api/routes` route — `03-server-routes.md` |
