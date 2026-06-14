<!--
  Example panel component, rendered when the user opens the plugin's menu item.
  This is a normal Vue 3 <script setup> SFC. It can use CloudTAK's component library
  (@tak-ps/vue-tabler) and Tabler icons, and call the plugin's server route via lib/api-client.

  Keep panels self-contained: fetch on mount, render state, handle empty/error explicitly.
-->
<template>
    <div class="px-3 py-2">
        <div class="d-flex align-items-center mb-3">
            <IconPuzzle :size="20" class="me-2" />
            <h3 class="m-0">Example Plugin</h3>
        </div>

        <p class="text-secondary">
            This panel is served by the example CloudTAK plugin. Replace it with your own UI.
        </p>

        <button class="btn btn-primary" :disabled="loading" @click="load">
            {{ loading ? 'Loading…' : 'Call server route' }}
        </button>

        <div v-if="error" class="text-danger mt-3">{{ error }}</div>

        <ul v-else-if="widgets.length" class="list-unstyled mt-3">
            <li v-for="w in widgets" :key="w.id" class="py-1 border-bottom">
                {{ w.name }} <span class="text-secondary">({{ w.id }})</span>
            </li>
        </ul>

        <p v-else-if="loaded" class="text-secondary mt-3">No widgets yet.</p>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IconPuzzle } from '@tabler/icons-vue';
import { listWidgets, type Widget } from '../lib/api-client.ts';

const widgets = ref<Widget[]>([]);
const loading = ref(false);
const loaded  = ref(false);
const error   = ref<string | null>(null);

async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        widgets.value = await listWidgets();
        loaded.value = true;
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}
</script>
