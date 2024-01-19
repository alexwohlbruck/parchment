<script setup lang="ts">
import {
  Globe2Icon,
  SatelliteIcon,
  BikeIcon,
  TramFrontIcon,
  CarIcon,
  MountainSnowIcon,
  Icon,
} from "lucide-vue-next";
import { Toggle } from "@/components/ui/toggle";
import { useMapStore } from "@/stores/map.store";
import type { BaseMap } from "@/types/map.types";
import H5 from "@/components/ui/typography/H5.vue";

const mapStore = useMapStore();

const basemaps: {
  name: BaseMap;
  icon: Icon;
}[] = [
  {
    name: "standard",
    icon: Globe2Icon,
  },
  {
    name: "satellite",
    icon: SatelliteIcon,
  },
];

const layers: {
  name: string;
  icon: Icon;
}[] = [
  {
    name: "Cycling",
    icon: BikeIcon,
  },
  {
    name: "Transit",
    icon: TramFrontIcon,
  },
  {
    name: "Traffic",
    icon: CarIcon,
  },
  {
    name: "Terrain",
    icon: MountainSnowIcon,
  },
];

function setBaseMap(name: BaseMap) {
  mapStore.setBaseMap(name);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <H5>Base map</H5>
    <div class="flex gap-2">
      <Toggle
        v-for="(basemap, i) in basemaps"
        :key="i"
        variant="outline"
        :aria-label="basemap.name"
        @click="setBaseMap(basemap.name)"
      >
        <component :is="basemap.icon" class="size-5" />
      </Toggle>
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
