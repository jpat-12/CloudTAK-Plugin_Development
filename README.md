# CloudTAK Plugin Development

A practical guide, reference, and working scaffold for building **CloudTAK plugins** —
extensions that add UI panels, map behavior, and API endpoints to a
[CloudTAK](https://github.com/dfpc-coe/CloudTAK) deployment (CloudTAK is the web/mobile
client for the [TAK](https://tak.gov) — Team Awareness Kit — ecosystem).

This repo is documentation + a copy-paste template. It is **not** itself a plugin you
install. Use it to understand the plugin contract, then build your own plugin against it.

> Verified against **CloudTAK 13.14.1**. The plugin API is young and still moving — see
> [`docs/01-architecture.md`](docs/01-architecture.md#versioning--stability) for how to
> pin and survive version drift.

---

## TL;DR — what a CloudTAK plugin is

A CloudTAK plugin has up to **two halves**, deployed into two different places in a
CloudTAK source checkout:

| Half | Lives in | What it does | Required? |
|------|----------|--------------|-----------|
| **Web plugin** | `api/web/plugins/<name>/` | A Vue 3 + TypeScript module. Adds menu items, routes/panels, floating panes, bottom-bar widgets, map markers. | Yes |
| **Server routes** | `api/routes/*.ts` | Express/TypeBox route files that add `/api/...` endpoints (own DB tables, proxies, etc). | Only if your plugin needs its own backend |

Both halves are **compiled into the CloudTAK image at build time** — there is no runtime
plugin loader, no `.zip` upload, no hot install. "Installing" a plugin means copying files
into the CloudTAK tree and **rebuilding the API container**. See
[`docs/04-build-install-deploy.md`](docs/04-build-install-deploy.md).

The smallest possible plugin is one file:

```ts
// api/web/plugins/hello.ts
import type { App } from 'vue';
import type { PluginAPI, PluginInstance } from '../plugin.ts';

export default class HelloPlugin implements PluginInstance {
    static async install(app: App, api: PluginAPI): Promise<PluginInstance> {
        return new HelloPlugin();
    }
    async enable(): Promise<void>  { console.log('hello plugin enabled'); }
    async disable(): Promise<void> { console.log('hello plugin disabled'); }
}
```

---

## Read this in order

1. **[`AGENTS.md`](AGENTS.md)** — operating manual for AI agents (and a tight checklist for
   humans). Hard rules, the lifecycle gotchas that will bite you, and a decision tree.
   **Start here if you are an automated agent.**
2. **[`docs/01-architecture.md`](docs/01-architecture.md)** — how plugins are discovered,
   built, and driven at runtime; the `install → enable/disable` lifecycle; the two halves;
   versioning and stability.
3. **[`docs/02-plugin-api-reference.md`](docs/02-plugin-api-reference.md)** — the complete
   `PluginAPI` surface with field-by-field schemas (`menu`, `routes`, `map`, `feature`,
   `breadcrumb`, `float`, `bottomBar`).
4. **[`docs/03-server-routes.md`](docs/03-server-routes.md)** — writing the server half:
   route files, TypeBox schemas, auth, the database, and the `std()` client the web half
   uses to call it.
5. **[`docs/04-build-install-deploy.md`](docs/04-build-install-deploy.md)** — the build
   pipeline, the native `WEB_PLUGINS` mechanism and its limits, `install.sh`, infra-TAK, and
   the service-worker refresh gotcha.
6. **[`docs/05-recipes.md`](docs/05-recipes.md)** — task-oriented cookbook: add a menu panel,
   drop a CoT marker on the map, add an API endpoint, open a floating pane, add a bottom-bar
   widget, stream features reactively.
7. **[`template/`](template/)** — a minimal, correct, copy-paste plugin (web + server +
   `install.sh`) you can rename and build on.

## Reference implementations to read

- **[`template/`](template/)** in this repo — minimal and heavily commented.
- The **CloudTAK Dispatcher plugin** (`cloudtak-dispatcher-plugin`) — a full real-world
  plugin: two halves, its own Postgres tables, map markers routed into DataSync feeds,
  mission chat. The single best worked example of everything in these docs.
- **`api/web/plugins/example.ts`** inside the CloudTAK repo — the upstream no-op example.
- **`dfpc-coe/CloudTAK-Plugin-Sample`** on GitHub — the upstream canonical sample plugin.
- The contract itself: **`api/web/plugin.ts`** in the CloudTAK repo is the source of truth.
  When these docs and that file disagree, the file wins — tell me and I'll fix the docs.
