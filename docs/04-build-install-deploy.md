# 04 — Build, install & deploy

How a plugin actually gets into a running CloudTAK. The short version: **copy both halves into
a CloudTAK checkout, rebuild the API image, then Refresh App in the browser.** There is no hot
install. Verified against **CloudTAK 13.14.1**.

---

## What "install" means

Plugins are **baked into the CloudTAK API container image at build time** (see
[`01-architecture.md`](01-architecture.md)). So every install/update/remove is:

1. Place files into the CloudTAK source tree:
   - web half → `api/web/plugins/<name>/` (entry must be `<name>/index.ts`)
   - server half → each `server/*.ts` → `api/routes/`
2. Rebuild the API image (`docker compose build --no-cache api`) — **5–15 minutes**.
3. Recreate the container (`docker compose up -d --force-recreate api`).
4. In the browser: **Settings → Refresh App** (see the service-worker note below).

Three ways to do steps 1–3, below.

---

## Path A — the native `WEB_PLUGINS` env var (web-only plugins)

CloudTAK has a built-in mechanism: set `WEB_PLUGINS` to a comma-separated list of git URLs.
The `api/Dockerfile` clones each into `web/plugins/` at build time:

```dockerfile
ARG WEB_PLUGINS
RUN if [ ! -z "$WEB_PLUGINS" ]; then \
        mkdir -p web/plugins; \
        for url in $(echo $WEB_PLUGINS | tr "," " "); do \
            git clone $url web/plugins/$(basename $url .git); \
        done \
    fi
```

It works **only for a web-only plugin whose repo root is the plugin folder**, because:

| Limitation | Why it bites |
|------------|--------------|
| Clones the **whole repo** into `web/plugins/<repo>/` | If your entry is `plugin/index.ts`, it ends up at `web/plugins/<repo>/plugin/index.ts` — **one level too deep** for the discovery glob (`plugins/*/index.ts`). Plugin never loads. |
| Only touches `web/plugins/` | It **cannot** install a server half. Your `/api/...` routes never reach `api/routes/`, so every API call 404s. |
| Web build type-checks everything under `web/plugins/` | If your repo also contains `server/*.ts`, the web build (`vue-tsc`) tries to type-check backend code and **fails the image build**. |

So `WEB_PLUGINS` is fine for a single-folder, web-only plugin published at its repo root. For
anything with a server half, or a `plugin/` + `server/` repo layout, use Path B or C.

`WEB_PLUGINS` is passed through `bin/build.js` / `docker-compose` as a build arg; set it where
your deployment configures build args (compose `.env`, CI, or infra-TAK).

---

## Path B — `install.sh` (standalone CloudTAK, two-half plugins)

Ship an `install.sh` with your plugin that copies both halves into a CloudTAK checkout and
rebuilds — exactly what `template/install.sh` and the dispatcher plugin do:

```bash
# from your plugin repo
./install.sh /path/to/CloudTAK          # install (defaults to ~/CloudTAK)
./install.sh --pull /path/to/CloudTAK   # git pull the plugin, then reinstall + rebuild
./install.sh --remove /path/to/CloudTAK # uninstall
./install.sh --no-build /path/to/CloudTAK  # copy files only, rebuild yourself later
```

What it does:
- `plugin/` → `api/web/plugins/<name>/`  (replaces the dir wholesale, so deleted files don't
  linger; and crucially lands the entry at the correct `<name>/index.ts` depth)
- every `server/*.ts` → `api/routes/`
- `docker compose build --no-cache api && docker compose up -d --force-recreate api`

This is the most portable option and the one to default to. A ready-to-edit copy is in
[`template/install.sh`](../template/install.sh).

---

## Path C — infra-TAK plugin marketplace (managed deployments)

If the CloudTAK was deployed by [infra-TAK](https://github.com/takwerx/infra-TAK), install/
update/remove from the **CloudTAK Plugins marketplace** in its console — no terminal. It does
the same two-halves copy + image rebuild that `install.sh` does, from the UI. Point users here
when they're on an infra-TAK-managed stack.

---

## The service-worker refresh gotcha

CloudTAK is a PWA with a **service worker that intercepts requests**. After a rebuild, a
normal hard refresh (Cmd/Ctrl-Shift-R) **does not** pick up the new plugin — the SW serves the
old bundle. The user must either:

- **Settings → Refresh App** inside CloudTAK (activates the new service worker), **or**
- close **all** CloudTAK tabs and reopen.

Always say this in your plugin's install output and README. Forgetting it is the #2 "it didn't
work" report (after the too-deep-nesting glob miss).

---

## Build-failure modes to expect

Because plugins compile into the image with no degraded mode, a mistake **fails the whole
build** (better than a silent half-broken plugin). The usual suspects:

| Symptom in build log | Cause | Fix |
|----------------------|-------|-----|
| `vue-tsc`/`npm run check` errors in `web/plugins/<name>` | web half has type errors, or backend `.ts` got copied under `web/plugins/` | fix types; keep `server/*.ts` out of the web tree (Path B/C, not `WEB_PLUGINS`) |
| `eslint` errors in `web/plugins/<name>` | web half lint failures | run `eslint .` in `plugin/` before shipping |
| API build lint errors in `api/routes/plugin-<name>.ts` | CloudTAK's route lint vs your style | add `/* eslint-disable */` at the file top |
| Plugin built fine but never appears | entry nested too deep, or wrong filename | ensure `api/web/plugins/<name>/index.ts` (or `<name>.ts`) exactly |
| Plugin appears but every API call 404s | server half not installed | copy `server/*.ts` → `api/routes/` and rebuild (don't rely on `WEB_PLUGINS`) |
| Old version keeps loading after rebuild | service worker | Settings → Refresh App |

---

## Pre-ship checklist

- [ ] `cd plugin && npm install && npx vue-tsc --noEmit && npx eslint .` — clean.
- [ ] Web entry resolves to `<name>/index.ts` once copied (not nested under `plugin/`).
- [ ] Each `server/*.ts` starts with `/* eslint-disable */`.
- [ ] `install.sh` copies both halves to the right paths and rebuilds (test `--remove` too).
- [ ] README states the minimum CloudTAK version and the **Settings → Refresh App** step.
