// Typed client for this plugin's server route (../../server/plugin-example.ts).
//
// INTERNAL REACH-IN: std() is a CloudTAK internal (api/web/src/std.ts), imported here by
// relative path. It attaches the logged-in user's bearer token automatically and standardizes
// errors. Isolating it in this one file means there's a single place to fix if CloudTAK moves
// it on an upgrade. See ../../AGENTS.md §4.
//
// Once installed, this file sits at CloudTAK/api/web/plugins/<name>/lib/api-client.ts, so the
// path back to CloudTAK's src is ../../../src/std.ts.
import { std } from '../../../src/std.ts';

// Mirror the server route's response shapes here so the web↔server contract lives in one place.
export interface Widget {
    id: string;
    name: string;
}

export async function listWidgets(): Promise<Widget[]> {
    const r = await std('/api/example/widgets', { method: 'GET' }) as { items?: Widget[] };
    return Array.isArray(r?.items) ? r.items : [];
}

export async function createWidget(name: string): Promise<Widget> {
    // std() JSON-encodes `body` for you and attaches auth.
    return await std('/api/example/widgets', { method: 'POST', body: { name } }) as Widget;
}
