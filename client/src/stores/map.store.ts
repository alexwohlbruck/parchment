import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { Basemap } from "../types/map.types";
import {
  Globe2Icon,
  SatelliteIcon,
  BikeIcon,
  TramFrontIcon,
  CarIcon,
  MountainSnowIcon,
  Icon,
} from "lucide-vue-next";

export const useMapStore = defineStore("map", () => {
  const basemaps = ref<
    {
      name: Basemap;
      icon: Icon;
    }[]
  >([
    {
      name: "standard",
      icon: Globe2Icon,
    },
    {
      name: "aerial",
      icon: SatelliteIcon,
    },
  ]);
  const activeBasemapName = ref<Basemap>("standard");

  const activeBasemap = computed(() => {
    return basemaps.value.find((b) => b.name === activeBasemapName.value);
  });

  function setBasemap(map: Basemap) {
    activeBasemapName.value = map;
  }

  const layers = ref<
    {
      name: string;
      icon: Icon;
    }[]
  >([
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
  ]);
  // function toggleLayer(layer: string) {
  //   layers.value = layers.value.map((l) => {
  //     l.active = l.name === layer ? !l.active : l.active;
  //     return l;
  //   });
  // }

  return {
    basemaps,
    setBasemap,
    activeBasemapName,
    activeBasemap,
    layers,
    // toggleLayer,
  };
});
