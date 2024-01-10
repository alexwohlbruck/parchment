<script setup>
import {
  GlobeIcon,
  Globe2Icon,
  BikeIcon,
  TramFrontIcon,
  CarIcon,
  MountainSnowIcon,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const basemaps = [
  {
    name: "Standard",
    icon: GlobeIcon,
  },
  {
    name: "Satellite",
    icon: Globe2Icon,
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
      <Button
        v-for="(basemap, i) in basemaps"
        :key="i"
        variant="outline"
        size="icon"
        to=""
      >
        <component :is="basemap.icon" class="size-5" />
      </Button>
    </div>

    <h5 class="scroll-m-20 text-sm font-semibold tracking-tight">Layers</h5>
    <div class="flex gap-2">
      <Button
        v-for="(layer, i) in layers"
        :key="i"
        variant="outline"
        size="icon"
        to=""
      >
        <component :is="layer.icon" class="size-5" />
      </Button>
    </div>
  </div>
</template>
