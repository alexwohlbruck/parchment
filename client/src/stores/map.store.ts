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
  const basemaps = ref<{
    [key in Basemap]: {
      name: string;
      icon: Icon;
      url: string;
    };
  }>({
    standard: {
      name: "Standard",
      icon: Globe2Icon,
      url: "mapbox://styles/mapbox/standard-beta",
    },
    aerial: {
      name: "Aerial",
      icon: SatelliteIcon,
      url: "mapbox://styles/mapbox/satellite-v9",
    },
  });
  const activeBasemapName = ref<Basemap>("standard");

  const activeBasemap = computed(() => {
    return basemaps.value[activeBasemapName.value];
  });

  function setBasemap(map: Basemap) {
    console.log(map);
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

  return {
    basemaps,
    setBasemap,
    activeBasemapName,
    activeBasemap,
    layers,
    // toggleLayer,
  };
});
