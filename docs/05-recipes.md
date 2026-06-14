# 05 — Recipes (cookbook)

Task-oriented, copy-paste snippets for the things plugins actually do. Each assumes a class
implementing `PluginInstance` with `this.api: PluginAPI`. Public-API recipes use
`@tak-ps/cloudtak`; recipes marked **(internal reach-in)** use relative CloudTAK imports —
wrap those in `lib/` and re-verify on each CloudTAK upgrade (`AGENTS.md` §4).

---

## R1 — Add a menu item that opens a panel

The canonical "menu → panel" plugin. Route in `install()`, menu in `enable()`, remove menu
(not route) in `disable()`.

```ts
import type { App } from 'vue';
import { markRaw } from 'vue';
import type { PluginAPI, PluginInstance, MenuItemConfig } from '@tak-ps/cloudtak';
import { IconHeadset } from '@tabler/icons-vue';
import MyPanel from './components/MyPanel.vue';

const MENU_KEY   = 'plugin-my';
const ROUTE_NAME = 'home-menu-my';

export default class MyPlugin implements PluginInstance {
    constructor(private api: PluginAPI) {}

    static async install(app: App, api: PluginAPI): Promise<MyPlugin> {
        api.routes.add(
            { path: 'my', name: ROUTE_NAME, component: MyPanel },
            'home-menu',                          // nest in the right-side menu drawer
        );
        return new MyPlugin(api);
    }

    async enable(): Promise<void> {
        this.api.menu.add({
            key: MENU_KEY, label: 'My Plugin', route: ROUTE_NAME,
            tooltip: 'My Plugin', description: 'Does a thing',
            icon: markRaw(IconHeadset),
        } as MenuItemConfig);
    }

    async disable(): Promise<void> {
        try { this.api.menu.remove(MENU_KEY); } catch { /* map not loaded yet */ }
    }
}
```

---

## R2 — Drop / update / remove a CoT marker on the map **(internal reach-in)**

Place real CoT (not a raw MapLibre layer) so it participates in DataSync, persistence, and
field-client rendering. Markers go through the **worker DB**, the same path CloudTAK's own draw
tools use.

```ts
import { normalize_geojson } from '@tak-ps/node-cot/normalize_geojson';
import type { useMapStore } from '../../../src/stores/map.ts';
type MapStore = ReturnType<typeof useMapStore>;

export async function dropMarker(mapStore: MapStore, m: {
    uid: string; callsign: string; remarks: string; lat: number; lon: number;
    feedGuid?: string;           // optional DataSync mission GUID to route into
}): Promise<void> {
    const feat = {
        id: m.uid, type: 'Feature',
        properties: { callsign: m.callsign, remarks: m.remarks },
        geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    };
    // normalize_geojson rebuilds properties from a whitelist and forces a generic type,
    // dropping how/icon — so restore the CoT atom type + how (+ icon) AFTER it.
    const norm: any = await normalize_geojson(feat as any);
    norm.properties.type = 'a-n-G';        // CoT 2525 atom type (neutral ground here)
    norm.properties.how  = 'h-g-i-g-o';
    // norm.properties.icon = '<iconset-uuid>:<Folder>/<file>';   // optional custom icon

    // origin routes the CoT into a SPECIFIC subscribed DataSync feed (else it's local/active):
    const withOrigin = m.feedGuid
        ? { ...norm, origin: { mode: 'Mission', mode_id: m.feedGuid } }
        : norm;

    await mapStore.worker.db.add(JSON.parse(JSON.stringify(withOrigin)), { authored: true });
}

// Update = re-add with the SAME uid (db.add detects + updates).
// Remove (and pull from its DataSync feed):
export async function removeMarker(mapStore: MapStore, uid: string): Promise<void> {
    await mapStore.worker.db.remove(uid, { mission: true });
}
```

Notes:
- `{ authored: true }` marks it as user-authored so it broadcasts like a hand-drawn marker.
- `origin: { mode: 'Mission', mode_id: feedGuid }` requires the feed to be **subscribed** in
  CloudTAK first.
- `JSON.parse(JSON.stringify(...))` strips any reactivity/proxies before handing to the worker.

---

## R3 — Add an API endpoint and call it from the panel

Server half (`server/plugin-my.ts`) — full pattern in [`03-server-routes.md`](03-server-routes.md):

```ts
/* eslint-disable */
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../lib/auth.js';
import Config from '../lib/config.js';

export default async function router(schema: Schema, config: Config) {
    await schema.get('/my/widgets', {
        name: 'List Widgets', group: 'My', description: 'List widgets',
        res: Type.Object({ items: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })) }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            res.json({ items: [{ id: '1', name: 'demo' }] });
        } catch (err) { Err.respond(err, res); }
    });
}
```

Web half client (`plugin/lib/my-client.ts`) — **(internal reach-in for `std`)**:

```ts
import { std } from '../../../src/std.ts';
export interface Widget { id: string; name: string }
export async function listWidgets(): Promise<Widget[]> {
    const r = await std('/api/my/widgets', { method: 'GET' }) as { items?: Widget[] };
    return r?.items ?? [];
}
```

---

## R4 — React to CoT features on the map (public API)

```ts
import type { Subscription } from 'rxjs';

private sub?: Subscription;

async enable(): Promise<void> {
    // Re-emits the full filtered list on every DB change.
    this.sub = this.api.feature
        .stream({ filter: (f) => f.properties?.type?.startsWith('a-h') })  // hostiles
        .subscribe((features) => { /* update panel state */ });
}
async disable(): Promise<void> { this.sub?.unsubscribe(); this.sub = undefined; }

// One-shot instead of a stream:
const all = await this.api.feature.list();
```

---

## R5 — Open a floating pane over the map (public API)

```ts
import { markRaw } from 'vue';
import MyFloat from './components/MyFloat.vue';

if (!this.api.float.has('my-float')) {
    this.api.float.add({
        uid: 'my-float', name: 'My Window',
        component: markRaw(MyFloat),
        props: { foo: 'bar' },
        width: 360, height: 240, x: 80, y: 80,
    });
}
// teardown in disable():  this.api.float.remove('my-float');
```

---

## R6 — Add a bottom-bar widget (public API)

```ts
import { markRaw } from 'vue';
import Clock from './components/Clock.vue';

async enable(): Promise<void>  { this.api.bottomBar.add({ key: 'plugin-my-clock', component: markRaw(Clock) }); }
async disable(): Promise<void> { try { this.api.bottomBar.remove('plugin-my-clock'); } catch {} }
```

> Confirm `api.bottomBar` exists in your target CloudTAK version's `plugin.ts` — it's a
> recent addition.

---

## R7 — Move / inspect the camera (public API)

```ts
this.api.map.flyTo({ center: [lon, lat], zoom: 14 });
const bounds = this.api.map.getBounds();
this.api.map.on('moveend', () => { /* … */ });   // remember to remove listeners in disable()
```

Use `api.map` for camera/inspection only; create data via the feature/worker path (R2), not
raw `map.addLayer`.

---

## R8 — Record a breadcrumb trail for a track (public API)

```ts
await this.api.breadcrumb.live.add(uid);            // start recording
const recording = await this.api.breadcrumb.live.list();
await this.api.breadcrumb.live.remove(uid);          // stop
```

---

## R9 — Post to a DataSync mission log / mission chat **(internal reach-in)**

Real plugins notify responders by writing to a DataSync feed's mission log and chat thread.
These are CloudTAK internals — keep them in `lib/`. Sketch (see the dispatcher plugin's
`lib/map-marker.ts` for the worked version):

```ts
import { std } from '../../../src/std.ts';
// Mission log — keyed by mission NAME, body field is `content`; entryUid links to a CoT marker:
await std(`/api/marti/missions/${encodeURIComponent(missionName)}/log`,
          { method: 'POST', body: { content: 'CALL FOR SERVICE …', entryUid: cotUid } });

// Mission chat — reuse CloudTAK's SubscriptionChat (writes local chat DB + broadcasts):
import SubscriptionChat from '../../../src/base/subscription-chat.ts';
const chat = new SubscriptionChat(feed.guid, feed.name);
await chat.send('message', { uid: senderUid, callsign }, mapStore.worker);
```

---

## Recipe → doc cross-reference

| Recipe | Stability | Deep dive |
|--------|-----------|-----------|
| R1 menu/panel | public | [02](02-plugin-api-reference.md), [01](01-architecture.md) lifecycle |
| R2 CoT marker | internal | this file; dispatcher `lib/map-marker.ts` |
| R3 API endpoint | mixed | [03](03-server-routes.md) |
| R4 feature stream | public | [02](02-plugin-api-reference.md#apifeature--the-local-cot-feature-database) |
| R5 float / R6 bottom bar | public | [02](02-plugin-api-reference.md) |
| R7 map / R8 breadcrumb | public | [02](02-plugin-api-reference.md) |
| R9 mission log/chat | internal | dispatcher `lib/map-marker.ts` |
