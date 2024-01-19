<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMapStore } from "@/stores/map.store";
import H5 from "@/components/ui/typography/H5.vue";

const mapStore = useMapStore();
const { basemaps, layers, activeBasemapName } = storeToRefs(mapStore);
</script>

<template>
  <div class="flex flex-col gap-2">
    <H5>Base map</H5>
    <div class="flex gap-2">
      <ToggleGroup type="single">
        <ToggleGroupItem
          v-for="(basemap, i) in basemaps"
          :key="i"
          :value="basemap.name"
          aria-label="Toggle bold"
          variant="outline"
          @click="mapStore.setBasemap(basemap.name)"
          class="flex gap-2"
        >
          <component :is="basemap.icon" class="size-5" />
          <span>{{ $filters.capitalize(basemap.name) }}</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <H5>Layers</H5>
    <div class="flex gap-2">
      <Toggle
        v-for="(layer, i) in layers"
        :key="i"
        variant="outline"
        :aria-label="layer.name"
      >
        <component :is="layer.icon" class="size-5" />
      </Toggle>
    </div>
  </div>
</template>
