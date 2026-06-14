# 03 — Server routes (the backend half)

When your plugin needs to persist data, proxy an external system, or expose `/api/...`
endpoints, you add a **server route file** to CloudTAK's `api/routes/`. CloudTAK auto-loads
everything there at boot, so a plugin backend is just one (or a few) `*.ts` files. Verified
against **CloudTAK 13.14.1**.

> You only need this half if the web half can't do the job client-side. Pure UI/map plugins
> skip it entirely.

---

## How routes are loaded

`api/index.ts` calls:

```ts
await schema.load(new URL('./routes/', import.meta.url), config, { silent: !!config.silent });
```

Every file in `api/routes/` that default-exports a `router` function is mounted under `/api`.
Your plugin drops `plugin-<name>.ts` there (an installer copies it — see
[`04-build-install-deploy.md`](04-build-install-deploy.md)). Name it distinctively
(`plugin-<name>.ts`) so it can't collide with a core route file.

---

## Anatomy of a route file

CloudTAK routes use [`@openaddresses/batch-schema`](https://www.npmjs.com/package/@openaddresses/batch-schema)
(`Schema`), [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) (`Type`) for
request/response schemas, `@openaddresses/batch-error` (`Err`) for errors, and a `Config`
object that carries the DB and models.

```ts
/* eslint-disable */                       // ← opt out of CloudTAK's version-specific route lint
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../lib/auth.js';          // note: .js — these import CloudTAK's compiled libs
import Config from '../lib/config.js';

export const Widget = Type.Object({
    id:   Type.String(),
    name: Type.String(),
});

export default async function router(schema: Schema, config: Config) {
    await schema.get('/widget', {
        name: 'List Widgets',
        group: 'Widget',                     // groups it in the generated API docs
        description: 'Return all widgets',
        query: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, default: 50 })),
        }),
        res: Type.Object({
            total: Type.Integer(),
            items: Type.Array(Widget),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);   // validates the bearer token
            const items = await loadWidgets(config, req.query.limit ?? 50);
            res.json({ total: items.length, items });
        } catch (err) {
            Err.respond(err, res);                          // uniform error envelope
        }
    });

    await schema.post('/widget', {
        name: 'Create Widget',
        group: 'Widget',
        description: 'Create a widget',
        body: Type.Object({ name: Type.String({ minLength: 1 }) }),
        res: Widget,
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            const widget = await createWidget(config, req.body.name);
            res.json(widget);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
```

Key points:
- `schema.get/post/put/patch/delete(path, definition, handler)`. Paths are relative to `/api`.
- `query`, `body`, `res` are **TypeBox** schemas — requests are validated in, responses
  validated out. This is also what generates CloudTAK's API docs.
- Always wrap handlers in `try/catch` and finish errors with `Err.respond(err, res)`. Throw
  `new Err(<status>, null, '<message>')` for expected failures (e.g. `new Err(404, null, 'Not
  found')`).
- `/* eslint-disable */` at the top: CloudTAK lints route files with house rules that differ
  between versions (brace style, etc.). A plugin can't satisfy every version, so opt out and
  rely on your plugin repo's own typecheck/lint (`AGENTS.md` R7).

---

## Auth

```ts
const user = await Auth.as_user(config, req);   // throws if the bearer token is invalid
// user.email, etc. Combine with config.models.Profile for profile data:
const profile = await config.models.Profile.from(user.email);
```

The web half's `std()` attaches the logged-in user's bearer token automatically, so an
authenticated CloudTAK session "just works" against your route. There's also
`Auth.as_resource` for connection/service tokens — read `api/lib/auth.ts` for the variants in
your version.

---

## Data: your own tables, or CloudTAK's models

`config` carries:

- **`config.pg`** — a Drizzle `PgDatabase` over CloudTAK's Postgres. Run raw SQL with
  `config.pg.execute(sql\`…\`)`. Own your tables with `CREATE TABLE IF NOT EXISTS` (idempotent;
  runs on every load) so they survive image rebuilds without touching CloudTAK's migrations:

  ```ts
  import { sql } from 'drizzle-orm';

  export default async function router(schema: Schema, config: Config) {
      // best-effort bootstrap so a transient DB hiccup can't block CloudTAK startup
      try {
          await config.pg.execute(sql`
              CREATE TABLE IF NOT EXISTS myplugin_widgets (
                  id   TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
              );
          `);
      } catch (err) { console.error('myplugin bootstrap failed', err); }

      // execute() returns the driver RowList; cast to your row shape:
      async function listWidgets(): Promise<Array<{ id: string; name: string }>> {
          const rows = await config.pg.execute(sql`SELECT id, name FROM myplugin_widgets ORDER BY name`);
          return rows as unknown as Array<{ id: string; name: string }>;
      }
      // … schema.get/post wiring as above …
  }
  ```

  Prefix table names with your plugin (`myplugin_*`) to avoid collisions. `jsonb` columns may
  come back as JSON strings from the driver — unwrap defensively before using them.

- **`config.models.*`** — CloudTAK's own data models (`Profile`, connections, layers, …). Use
  these to read/write core CloudTAK data rather than hitting its tables directly.

---

## Proxying an external service

A server route is also the place to put a keyed proxy (so secrets stay server-side) or to
talk to another TAK Server plugin. Pattern: validate the user with `Auth.as_user`, read config
from env/`config`, `fetch()` the upstream, normalize, and return a TypeBox-validated response.
Keep secrets in the API process's environment — never in the web half (it ships to the
browser).

---

## Calling your route from the web half: `std()`

The web half calls the API through `std()` (from `api/web/src/std.ts`), which attaches the
user's bearer token and standardizes errors. Because it's a CloudTAK internal, import it by
relative path and isolate calls in a `lib/` client (`AGENTS.md` §4).

```ts
import { std } from '../../../src/std.ts';

export interface Widget { id: string; name: string }

export async function listWidgets(): Promise<Widget[]> {
    const r = await std('/api/widget', { method: 'GET' }) as { items?: Widget[] };
    return Array.isArray(r?.items) ? r.items : [];
}

export async function createWidget(name: string): Promise<Widget> {
    const r = await std('/api/widget', { method: 'POST', body: { name } }) as Widget;
    return r;
}
```

`std(url, opts)` options: `{ token?, download?, headers?, body?, method?, signal?, timeout? }`.
Pass `body` as a plain object (it's JSON-encoded for you). A bare path like `/api/widget` is
resolved against the runtime server URL.

Keep a typed client module per server route (one `lib/<thing>-client.ts` mirroring the route's
request/response shapes) so the web↔server contract lives in one place. This is exactly how the
dispatcher plugin's `lib/events-client.ts` mirrors `server/plugin-dispatcher.ts`.

---

## Checklist for a server route file

- [ ] Filename `plugin-<name>.ts`, default-exports `async function router(schema, config)`.
- [ ] `/* eslint-disable */` at the top (R7).
- [ ] Every endpoint has `query`/`body`/`res` TypeBox schemas and `name`/`group`/`description`.
- [ ] Every handler validates auth (`Auth.as_user`) and wraps in `try/catch` → `Err.respond`.
- [ ] Own tables created with `CREATE TABLE IF NOT EXISTS`, names prefixed with your plugin.
- [ ] A matching typed `lib/<thing>-client.ts` in the web half using `std()`.
