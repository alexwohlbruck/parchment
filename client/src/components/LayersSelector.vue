<script setup>
import {
  Globe2Icon,
  SatelliteIcon,
  BikeIcon,
  TramFrontIcon,
  CarIcon,
  MountainSnowIcon,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

const basemaps = [
  {
    name: "Standard",
    icon: Globe2Icon,
  },
  {
    name: "Satellite",
    icon: SatelliteIcon,
  },
];

const layers = [
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
</script>

<template>
  <!-- TODO: Create typography classes -->
  <div class="flex flex-col gap-2">
    <h5 class="scroll-m-20 text-sm font-semibold tracking-tight">Base map</h5>
    <div class="flex gap-2">
      <Toggle
        v-for="(basemap, i) in basemaps"
        :key="i"
        variant="outline"
        :aria-label="basemap.name"
      >
        <component :is="basemap.icon" class="size-5" />
      </Toggle>
    </div>

    <h5 class="scroll-m-20 text-sm font-semibold tracking-tight">Layers</h5>
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
