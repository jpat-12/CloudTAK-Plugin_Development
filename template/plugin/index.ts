// CloudTAK plugin — example scaffold (web half entry point).
//
// Once installed, this file lands at:  CloudTAK/api/web/plugins/<name>/index.ts
// CloudTAK discovers it with a BUILD-TIME glob (plugins/*/index.ts) and drives it through the
// install → (enable ⇄ disable) lifecycle. See ../../AGENTS.md and ../../docs/01-architecture.md.
//
// The pattern below is the canonical "menu item → panel" plugin:
//   • install():  register the ROUTE (once).
//   • enable():   add the MENU ITEM (repeats on every map-ready).
//   • disable():  remove the MENU ITEM only — NOT the route. (disable() is called BEFORE the
//                 first enable() with the map not loaded; removing the route here would make
//                 the next enable()'s menu.add fail with "route not found".)

import type { App } from 'vue';
import { markRaw } from 'vue';
import type { PluginAPI, PluginInstance, MenuItemConfig } from '@tak-ps/cloudtak';
import { IconPuzzle } from '@tabler/icons-vue';
import Main from './components/Main.vue';

// Namespace these to your plugin so they can't collide with core CloudTAK or other plugins.
const MENU_KEY   = 'plugin-example';
const ROUTE_NAME = 'home-menu-example';

export default class ExamplePlugin implements PluginInstance {
    api: PluginAPI;

    constructor(api: PluginAPI) {
        this.api = api;
    }

    // Called ONCE at startup. Do one-time setup here (routes, clients, env detection).
    static async install(app: App, api: PluginAPI): Promise<ExamplePlugin> {
        void app; // the Vue app instance, if you need app.component()/app.use() — usually not.

        // Register the panel route under 'home-menu' so it renders in the right-side menu drawer.
        api.routes.add(
            { path: 'example', name: ROUTE_NAME, component: Main },
            'home-menu',
        );

        return new ExamplePlugin(api);
    }

    // Called when the map becomes ready (and may be called again). "Show my UI."
    async enable(): Promise<void> {
        this.api.menu.add({
            key:         MENU_KEY,
            label:       'Example',
            route:       ROUTE_NAME,
            tooltip:     'Example Plugin',
            description: 'Starter CloudTAK plugin scaffold',
            // markRaw the icon so Vue doesn't make the component reactive.
            icon:        markRaw(IconPuzzle) as unknown as MenuItemConfig['icon'],
        } as MenuItemConfig);
    }

    // Called when the map is not ready (and once before the first enable()). "Hide my UI."
    // Remove ONLY what enable() added. Leave the route in place. Guard against the map store
    // not being loaded yet.
    async disable(): Promise<void> {
        try { this.api.menu.remove(MENU_KEY); } catch { /* map not loaded — ignore */ }
    }
}
