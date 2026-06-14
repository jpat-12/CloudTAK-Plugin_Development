// CloudTAK plugin — example scaffold (server half).
//
// Once installed, this file lands at:  CloudTAK/api/routes/plugin-example.ts
// CloudTAK auto-loads every file in api/routes/ at boot via schema.load('./routes/'), so simply
// dropping this here adds the endpoints below under /api. See ../../docs/03-server-routes.md.
//
// /* eslint-disable */ : CloudTAK lints route files with house rules that change between
// versions (brace style, etc.). A plugin can't satisfy every version, so we opt out and rely
// on this plugin repo's own typecheck/lint for correctness. (AGENTS.md R7.)
/* eslint-disable */
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../lib/auth.js';
import Config from '../lib/config.js';

// Response/row shape, mirrored by the web client (plugin/lib/api-client.ts).
const Widget = Type.Object({
    id:   Type.String(),
    name: Type.String(),
});

// Cast helper: config.pg.execute() returns the driver's RowList; cast to the SELECTed shape.
async function query<T>(config: Config, statement: ReturnType<typeof sql>): Promise<T[]> {
    const result = await config.pg.execute(statement);
    return result as unknown as T[];
}

export default async function router(schema: Schema, config: Config) {
    // Idempotent table bootstrap. CREATE TABLE IF NOT EXISTS is safe to re-run on every load
    // and survives API image rebuilds without touching CloudTAK's own drizzle migrations.
    // Best-effort so a transient DB hiccup can't block CloudTAK startup. Prefix tables with the
    // plugin name to avoid collisions.
    try {
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS example_widgets (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `);
    } catch (err) {
        console.error('example plugin: table bootstrap failed', err);
    }

    await schema.get('/example/widgets', {
        name: 'List Widgets',
        group: 'Example',
        description: 'Return all widgets created by the example plugin',
        res: Type.Object({
            total: Type.Integer(),
            items: Type.Array(Widget),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req); // validate the caller's bearer token
            const items = await query<{ id: string; name: string }>(
                config,
                sql`SELECT id, name FROM example_widgets ORDER BY created_at DESC`,
            );
            res.json({ total: items.length, items });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/example/widgets', {
        name: 'Create Widget',
        group: 'Example',
        description: 'Create a widget',
        body: Type.Object({
            name: Type.String({ minLength: 1 }),
        }),
        res: Widget,
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            const id = randomUUID();
            await config.pg.execute(
                sql`INSERT INTO example_widgets (id, name) VALUES (${id}, ${req.body.name})`,
            );
            res.json({ id, name: req.body.name });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
