# AGENTS.md — Operating manual for building CloudTAK plugins

This file is written for an AI coding agent (Claude Code, Cursor, etc.) that has been asked
to **create or modify a CloudTAK plugin**. It front-loads the rules and the failure modes so
you don't have to rediscover them. Humans: this doubles as a tight checklist.

Conventions used below: **MUST / MUST NOT / SHOULD** carry their normal RFC-2119 weight.

---

## 0. Orient before you write

Before generating any code, establish these facts about the target environment. Do not assume.

1. **CloudTAK version.** Read `package.json` `version` at the CloudTAK repo root. The plugin
   API differs across minor versions (bottom bar, breadcrumb, float, proxy mode were all
   added over time). These docs are verified against **13.14.1**.
2. **The contract file.** Read `api/web/plugin.ts` in the CloudTAK checkout. It is the single
   source of truth for `PluginAPI`, `PluginInstance`, `PluginStatic`, and the config types.
   If it disagrees with this manual, **the file wins.**
3. **The loader.** Read `api/web/src/main.ts`. It shows exactly how plugins are discovered
   and how `install`/`enable`/`disable` are called. Confirm the discovery glob and the
   `isLoaded` watcher still look like what Section 2 describes.
4. **Does the plugin need a backend?** If it only manipulates the map/menu/UI, you need the
   **web half only**. If it needs to persist data, proxy an external service, or expose
   `/api/...` endpoints, you also need the **server half** (`docs/03-server-routes.md`).

---

## 1. Hard rules (the ones that cause real bugs)

- **R1 — Register routes in `install()`, NOT in `enable()`/`disable()`.**
  The runtime calls your `disable()` *before* your first `enable()` (the `isLoaded` watcher
  runs with `immediate: true` and `isLoaded` starts `false`). If `disable()` removes a route,
  the next `enable()`'s `menu.add` fails with *"route not found"*. Add routes once in
  `install()`; never remove them in `disable()`. See Section 2.

- **R2 — `routes.add` BEFORE `menu.add`.**
  `menu.add` validates that the route exists (unless `routeExternal: true`) and silently
  warns + bails if it doesn't. Order matters.

- **R3 — Make `enable()`/`disable()` idempotent and symmetric.**
  `enable()` adds exactly the user-facing surface (menu item, bottom-bar widget, floating
  pane). `disable()` removes exactly that surface and nothing else. Both may be called more
  than once. Wrap removals in `try/catch` — the map store may not be loaded yet.

- **R4 — `markRaw()` every Vue component / icon you hand to the API.**
  Menu icons, route components, floating-pane components, bottom-bar components. Vue must not
  make them reactive. Tabler icons in particular: `markRaw(IconFoo)`. (The float and bottom
  bar APIs `markRaw` internally, but doing it at the call site is harmless and consistent.)

- **R5 — Keys and route names MUST be globally unique and namespaced to your plugin.**
  e.g. menu key `plugin-tak-dispatcher`, route name `home-menu-tak-dispatcher`. Collisions
  with core CloudTAK or another plugin silently drop your item.

- **R6 — Web half MUST type-check and lint clean** (`vue-tsc --noEmit`, `eslint`). The
  CloudTAK image build runs `npm run check && npm run lint` on `api/web` and **fails the whole
  build** if your plugin doesn't pass. There is no "loaded but broken" state — a bad plugin
  means no CloudTAK.

- **R7 — Server route files MUST NOT break CloudTAK's own lint.**
  CloudTAK lints `api/routes/*.ts` with its own house rules, which change between versions. A
  plugin can't satisfy every version's style. Put `/* eslint-disable */` at the top of each
  server route file you ship (the dispatcher plugin does exactly this) and rely on your own
  repo's lint/typecheck for correctness.

- **R8 — Never edit CloudTAK core files to make a plugin work.**
  A plugin is additive: files dropped into `api/web/plugins/<name>/` and `api/routes/`. If you
  find yourself patching `plugin.ts`, `main.ts`, a core route, or a core store, stop — that's a
  CloudTAK change, not a plugin, and it won't survive an upgrade. Raise it with the user.

- **R9 — Prefer the public surface (`@tak-ps/cloudtak`) over reaching into internals.**
  See Section 4. Reaching into `../../../src/...` works but is unsupported and breaks on
  upgrades. Do it only when the public API genuinely can't express what you need, and isolate
  it in a `lib/` client so there's one place to fix later.

---

## 2. The lifecycle (memorize this)

Discovery and execution, from `api/web/src/main.ts`:

```ts
// BUILD TIME: a static glob compiles every plugin into the bundle.
const plugins = import.meta.glob(['../plugins/*.ts', '../plugins/*/index.ts'], { eager: true });

// STARTUP: install() runs once per plugin, returns a PluginInstance.
for (const path in plugins) {
    pluginInstances.push(await plugins[path].default.install(app, pluginAPI));
}

// RUNTIME: enable on map-ready, disable on map-not-ready. immediate:true ⇒
// the FIRST call is disable() with isLoaded=false, BEFORE any enable().
watch(() => mapStore.isLoaded, async (isLoaded) => {
    for (const inst of pluginInstances) await (isLoaded ? inst.enable() : inst.disable());
}, { immediate: true });
```

Consequences you must design around:
- `install(app, api)` is your **one-time setup**: register routes, build clients, detect
  environment. Returns the instance (often `new MyPlugin(api)`).
- `enable()` / `disable()` are a **toggle that fires repeatedly** across the session and on
  every navigation that flips map readiness. Treat them as "show my UI" / "hide my UI", not
  "construct" / "destruct".
- The plugin file's `default` export MUST be a class with a `static install()` and instance
  `enable()`/`disable()` — i.e. it implements `PluginInstance` and its constructor/`install`
  match `PluginStatic`.

---

## 3. File layout the build expects

The discovery glob is `['../plugins/*.ts', '../plugins/*/index.ts']` relative to
`api/web/src/`. So inside a CloudTAK checkout your web half must land as **exactly one** of:

```
api/web/plugins/<name>.ts                 # single-file plugin
api/web/plugins/<name>/index.ts           # multi-file plugin (entry MUST be index.ts)
```

> Common deploy bug: cloning a whole plugin repo into `api/web/plugins/<repo>/` puts your
> entry at `api/web/plugins/<repo>/plugin/index.ts` — one level too deep — and the glob never
> finds it. The web files must sit so the entry is `<name>/index.ts`. This is the single
> biggest reason a plugin "installs" but never appears. See `docs/04-build-install-deploy.md`.

A recommended **source repo** layout (what you author; an installer copies the halves into
place — mirror `template/`):

```
my-plugin/
  plugin/            # → copied to  api/web/plugins/<name>/
    index.ts         #   entry (class implementing PluginInstance)
    package.json     #   dev-only: typecheck/lint against CloudTAK web types
    tsconfig.json
    components/*.vue
    lib/*.ts         #   API clients, map helpers — isolate internal reach-ins here
  server/            # → each *.ts copied to  api/routes/
    plugin-<name>.ts
  install.sh         # copies both halves into a CloudTAK checkout + rebuilds
  README.md
```

---

## 4. Public API vs. internal reach-ins

**Supported, stable** — import from the published surface:

```ts
import type { PluginAPI, PluginInstance, MenuItemConfig,
              BottomBarItemConfig, DBFeature } from '@tak-ps/cloudtak';
```

`@tak-ps/cloudtak` is a Vite alias to `api/web/plugin.ts` (and a publishable types package).
Everything exposed on `PluginAPI` is intended for plugins. Full reference:
[`docs/02-plugin-api-reference.md`](docs/02-plugin-api-reference.md).

**Unsupported but sometimes necessary** — reaching into CloudTAK internals by relative path:

```ts
import { std } from '../../../src/std.ts';                 // authed API client
import { normalize_geojson } from '@tak-ps/node-cot/normalize_geojson';
// mapStore.worker.db.add(...) for placing CoT markers, SubscriptionChat, ProfileConfig, ...
```

These are how real plugins (e.g. the dispatcher) get things the public API doesn't cover yet —
calling your own server routes, dropping CoT markers, posting mission chat. They **will**
break across CloudTAK versions. Rules: keep every reach-in behind a thin wrapper in `lib/`,
comment *why* the public API didn't suffice, and re-verify them on each CloudTAK bump.

---

## 5. Definition of done

Before you tell the user it's finished:

- [ ] `cd plugin && npm install && npx vue-tsc --noEmit` passes (R6).
- [ ] `cd plugin && npx eslint .` passes (R6).
- [ ] Routes registered in `install()`; `disable()` removes only what `enable()` added (R1).
- [ ] Every component/icon passed to the API is `markRaw`'d (R4).
- [ ] Keys/route names are namespaced and unique (R5).
- [ ] If there's a server half: each route file starts with `/* eslint-disable */` (R7) and
      defines TypeBox `req`/`res` schemas (`docs/03-server-routes.md`).
- [ ] No CloudTAK core file was modified (R8).
- [ ] `install.sh` (or documented steps) copies both halves to the right paths and rebuilds.
- [ ] README states the minimum CloudTAK version you tested against.

## 6. What NOT to do (anti-patterns seen in the wild)

- ❌ Using `WEB_PLUGINS` for a plugin that has a server half. It only handles the web half,
  clones the repo too deep, and drops `server/*.ts` where the web build type-checks and
  fails. Use an installer that places both halves. (`docs/04`.)
- ❌ Mutating the maplibre map directly with custom layers/sources when CloudTAK's feature DB
  + worker can do it. Markers go through `mapStore.worker.db.add(...)`, not raw `map.addLayer`,
  so they participate in CoT, DataSync, and persistence. (`docs/05`, recipe: CoT marker.)
- ❌ Expecting a hard refresh to load your rebuilt plugin. A service worker intercepts
  requests; the user must do **Settings → Refresh App** (or close all tabs). (`docs/04`.)
- ❌ Storing secrets/tokens in the plugin. The web half runs in the browser. Auth is the
  user's bearer token, attached automatically by `std()`.
