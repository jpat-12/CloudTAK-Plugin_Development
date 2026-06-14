# 01 — Architecture

How CloudTAK plugins are discovered, built, and run. Read this once and the rest of the docs
are reference. Verified against **CloudTAK 13.14.1**.

---

## The two halves

CloudTAK ships as a single repo with an Express/Node **API** (`api/`) that also serves a
Vue 3 **web client** (`api/web/`). A plugin can extend either or both:

```
CloudTAK/
  api/
    index.ts                 ← boots Express, calls schema.load('./routes/')
    routes/                  ← SERVER HALF lands here: plugin-<name>.ts
    web/
      plugin.ts              ← THE CONTRACT (PluginAPI, PluginInstance, config types)
      src/main.ts            ← the plugin loader (discovery + lifecycle)
      src/std.ts             ← std(): authed fetch the web half uses to call the API
      plugins/               ← WEB HALF lands here: <name>/index.ts  or  <name>.ts
        example.ts           ← upstream no-op example
```

- **Web half** → `api/web/plugins/<name>/` — a Vue/TS module. This is the part everyone calls
  "the plugin." Required.
- **Server half** → `api/routes/*.ts` — optional Express route files, only if your plugin
  needs its own `/api/...` endpoints (its own DB tables, a proxy to an external system, etc).

They are independent: a web-only plugin is complete on its own; a server route with no web
half is just an API extension. Most non-trivial plugins ship both and the web half talks to
the server half over HTTP via `std()`.

---

## Discovery & build (web half)

There is **no runtime plugin loader**. Plugins are compiled into the web bundle at build time
by a static glob in `api/web/src/main.ts`:

```ts
const plugins = import.meta.glob(
    ['../plugins/*.ts', '../plugins/*/index.ts'],
    { eager: true }
);
```

Implications:

- A plugin must resolve to **`plugins/<name>.ts`** (single file) or
  **`plugins/<name>/index.ts`** (folder). The entry is always `index.ts` for the folder form.
  Nesting deeper (`plugins/<name>/plugin/index.ts`) is invisible to the glob — the #1 cause of
  "installed but never shows up." See [`04-build-install-deploy.md`](04-build-install-deploy.md).
- Because it's `eager: true` and build-time, **adding/removing a plugin requires rebuilding the
  API image**. No hot reload, no upload-a-zip.
- The web build (`npm run check && npm run lint && npm run build` inside `api/web`) compiles
  *your plugin's source as part of CloudTAK*. If your plugin fails typecheck or lint, the
  **entire image build fails**. There is no degraded mode. (This is why your plugin's own CI
  must be clean — see `AGENTS.md` R6.)

The Vite config (`api/web/vite.config.ts`) aliases the public import path:

```ts
resolve: { alias: { '@tak-ps/cloudtak': path.resolve(__dirname, './plugin.ts') } }
```

So `import ... from '@tak-ps/cloudtak'` inside a plugin resolves to the contract file.

---

## The lifecycle (web half)

Three methods, two of them a repeating toggle. From `api/web/src/main.ts`:

```ts
const pluginAPI = new PluginAPI(app, router, pinia);
const pluginInstances = [];

// 1) install() — ONCE per plugin at startup. Returns the instance.
for (const path in plugins) {
    pluginInstances.push(await plugins[path].default.install(app, pluginAPI));
}

// 2/3) enable()/disable() — a toggle bound to map readiness.
//      immediate:true ⇒ first invocation is disable() with isLoaded=false.
watch(() => mapStore.isLoaded, async (isLoaded) => {
    for (const inst of pluginInstances) {
        await (isLoaded ? inst.enable() : inst.disable());
    }
}, { immediate: true });
```

| Method | Called | Purpose | Put here |
|--------|--------|---------|----------|
| `static install(app, api)` | once, at startup | one-time setup | **route registration**, build API clients, environment detection. Returns `new MyPlugin(api)`. |
| `enable()` | when map becomes ready (repeats) | "show my UI" | `menu.add`, `bottomBar.add`, open default floating panes |
| `disable()` | when map not ready (repeats, **and once before the first enable**) | "hide my UI" | `menu.remove`, `bottomBar.remove`, `float.remove` — **only what enable added** |

### The disable-before-enable trap

Because the watcher is `immediate: true` and `mapStore.isLoaded` starts `false`, the very
first lifecycle call is `disable()`. If `disable()` tears down a **route**, the subsequent
`enable()` calls `menu.add` against a now-missing route and silently fails ("route not
found"). The fix the real plugins use:

```ts
static async install(app, api) {
    api.routes.add({ path: 'my-panel', name: ROUTE_NAME, component: MyPanel }, 'home-menu');
    return new MyPlugin(api);
}
async enable()  { this.api.menu.add({ key: MENU_KEY, route: ROUTE_NAME, /* … */ }); }
async disable() { try { this.api.menu.remove(MENU_KEY); } catch { /* map not loaded */ } }
//   ^ note: removes the MENU item only. The ROUTE stays, registered once in install().
```

**Rule:** routes are registered once in `install()` and never removed; `enable`/`disable`
only manage the menu/bottom-bar/float surface.

---

## Server half: route loading

CloudTAK auto-loads every file in `api/routes/` at boot (`api/index.ts`):

```ts
await schema.load(new URL('./routes/', import.meta.url), config, { silent: !!config.silent });
```

So a plugin's server half is just: **drop `plugin-<name>.ts` into `api/routes/`**. Each file
default-exports `async function router(schema, config)` and registers endpoints on `schema`.
Full pattern, auth, DB access, and the `std()` client in
[`03-server-routes.md`](03-server-routes.md).

Server route files are compiled and linted by the **API** build (separate from the web build),
again with no degraded mode: a broken route file fails the image build. CloudTAK's route lint
rules change between versions, so plugin route files opt out with `/* eslint-disable */` at the
top and rely on the plugin repo's own checks (`AGENTS.md` R7).

---

## Request flow at runtime

```
┌─────────────────────────── Browser (CloudTAK web client) ───────────────────────────┐
│  Vue app                                                                             │
│   ├─ core CloudTAK UI                                                                │
│   └─ your plugin (menu item → route/panel component)                                 │
│         │  std('/api/your-thing', { method, body })   ← bearer token auto-attached   │
│         │  mapStore.worker.db.add(cot)                ← place CoT markers             │
└─────────┼───────────────────────────────────────────────────────────────────────────┘
          │ HTTPS
┌─────────▼───────────────────────── CloudTAK API (Node/Express) ─────────────────────┐
│  schema.load('./routes/')                                                            │
│   ├─ core routes (/api/marti/…, /api/profile, …)                                     │
│   └─ your plugin-<name>.ts  →  /api/your-thing                                        │
│         ├─ Auth.as_user(config, req)      ← validate the bearer token                │
│         ├─ config.pg.execute(sql`…`)      ← your own Postgres tables                  │
│         └─ config.models.*                ← CloudTAK's data models                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

The web half never holds a service credential. It carries the **logged-in user's bearer
token**, which `std()` attaches automatically and which the server half validates with
`Auth.as_user`.

---

## Versioning & stability

The plugin API is **young and still expanding** — the CloudTAK changelog shows menu/router,
then `feature`/`map`, then `FloatingPane`, breadcrumbs, CSP proxy mode, and the bottom bar all
landing across successive releases. Treat it as a moving target:

- **Pin a minimum version.** State the lowest CloudTAK you've tested against in your README
  (the dispatcher plugin, for instance, requires `13.2+`). Don't assume an API that isn't in
  the contract file of the version you're targeting.
- **The contract file is truth.** `api/web/plugin.ts` at the version you're building against
  defines what exists. Read it; don't trust memory or these docs over it.
- **Public surface is stable-ish; internals are not.** `PluginAPI` members rarely break.
  Relative-path reach-ins (`../../../src/...`, `mapStore.worker.db`, `SubscriptionChat`) break
  freely between versions — wrap them in `lib/` and re-verify on each bump (`AGENTS.md` §4).
- **Server route house-style changes between versions** — hence `/* eslint-disable */` on
  shipped route files.

---

## Mental model summary

- A plugin is **additive source** copied into a CloudTAK checkout, then **baked into the image
  by a rebuild**. It is not a runtime artifact.
- The **web half** is discovered by a build-time glob and driven by `install → (enable ⇄
  disable)`. Routes in `install`, UI in `enable`, teardown the UI (not routes) in `disable`.
- The **server half** is auto-loaded route files giving you `/api/...` endpoints, your own DB,
  and access to CloudTAK's models, behind the user's auth.
- The web half talks to the server half with `std()`; both fail loudly (build break) rather
  than silently, so keep them clean.
