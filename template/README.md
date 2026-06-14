# CloudTAK Plugin — Example Scaffold

A minimal, correct, two-half CloudTAK plugin you can copy and rename. It adds an **Example**
item to the right-side menu that opens a panel, and a small server route
(`/api/example/widgets`) backed by its own Postgres table.

Read the docs in the parent repo first — especially [`../AGENTS.md`](../AGENTS.md) and
[`../docs/01-architecture.md`](../docs/01-architecture.md).

## Layout

```
template/
  plugin/                     → copied to  CloudTAK/api/web/plugins/<name>/
    index.ts                  #   entry: class implementing PluginInstance (menu → panel)
    components/Main.vue        #   the panel UI
    lib/api-client.ts         #   typed client for the server route (uses CloudTAK's std())
    package.json, tsconfig.json  #   dev-only: typecheck/lint in isolation
  server/                     → each *.ts copied to  CloudTAK/api/routes/
    plugin-example.ts         #   /api/example/widgets endpoints + table bootstrap
  install.sh                  #   copies both halves into a CloudTAK checkout + rebuilds
```

## Make it yours

1. Copy `template/` to a new repo. Rename:
   - `INSTALL_DIR_NAME` in `install.sh` (the web-plugin folder name).
   - `MENU_KEY` / `ROUTE_NAME` in `plugin/index.ts` (namespace to your plugin).
   - `server/plugin-example.ts` → `server/plugin-<name>.ts`, the `/example/...` paths, the
     `example_widgets` table, and the matching paths in `plugin/lib/api-client.ts`.
   - `name`/`description` in `plugin/package.json`.
2. If you don't need a backend, delete `server/` and `plugin/lib/api-client.ts` and the button
   in `Main.vue` — a web-only plugin is complete on its own.

## Develop (typecheck + lint in isolation)

```bash
cd plugin
npm install            # pulls CloudTAK web types via the file: devDependency — adjust the
                       # path in package.json to your local CloudTAK checkout
npm run check          # vue-tsc --noEmit   (MUST pass — the image build runs this)
npm run lint           # eslint .           (MUST pass — the image build runs this)
```

## Install into a CloudTAK deployment

```bash
./install.sh /path/to/CloudTAK          # copies both halves + rebuilds the API image (5-15 min)
./install.sh --remove /path/to/CloudTAK # uninstall
./install.sh --no-build /path/to/CloudTAK  # copy only; rebuild yourself
```

After the rebuild: in CloudTAK go to **Settings → Refresh App** (a hard refresh won't work —
the service worker intercepts requests). The **Example** item appears at the bottom of the
right-side menu.

## Requirements

- CloudTAK 13.2+ (developed/verified against 13.14.1).
