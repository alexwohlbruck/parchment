<template>
  <div ref="mapContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
// import { useRouter } from "vue-router";
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  // Marker,
  // Popup,
  // Layer,
  // Source,
  // LngLatBounds,
  // LngLat,
} from "mapbox-gl";
import layers from "./layers";
// import { useSettingsStore } from "@/stores/settings";
// import { AppTheme } from "../../types/settings";
import { useDark } from "@vueuse/core";

const projection: any = localStorage.getItem("projection") || "globe";

// const router = useRouter();
// const settingsStore = useSettingsStore();

const dark = useDark();

const mapContainer = ref(null);
let map;

onMounted(() => {
  // For testing
  const { lng, lat, zoom, bearing, pitch } = {
    lng: -80.8432808,
    lat: 35.2205601,
    bearing: 0,
    pitch: 0,
    zoom: 14,
  };

  map = new Map({
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    container: mapContainer.value as any,
    style: "mapbox://styles/mapbox/standard-beta",
    center: [lng, lat],
    bearing,
    pitch,
    zoom,
    attributionControl: false,
    projection: {
      name: projection,
    },
  });

  map.addControl(new ScaleControl(), "bottom-right");
  map.addControl(new NavigationControl(), "bottom-right");
  map.addControl(new GeolocateControl(), "bottom-right");
  map.addControl(
    new AttributionControl({
      compact: true,
    }),
    "bottom-left"
  );

  map.on("load", function () {
    addLayers();
    setMapTheme(dark.value);
    togglePoiLabels(false);
  });

  function addLayers() {
    Object.values(layers).forEach((layerType) => {
      layerType.layers.forEach((layer) => {
        if (!layer.enabled) return;
        const { meta, source } = layer;
        const id = layer.name;
        map.addSource(id, {
          id,
          ...source,
        });
        map.addLayer({
          source: id,
          id,
          ...meta,
          slot: "middle",
        });
      });
    });
  }

  function setMapTheme(dark: boolean) {
    let lightPreset;
    switch (dark) {
      case false:
        lightPreset = "day";
        break;
      case true:
        lightPreset = "night";
        break;
    }
    map.setConfigProperty("basemap", "lightPreset", lightPreset);
  }

  function togglePoiLabels(value: boolean) {
    map.setConfigProperty("basemap", "showPointOfInterestLabels", value);
  }

  watch(dark, setMapTheme);
});

onUnmounted(() => {
  map.remove();
});
</script>

<style>
.mapboxgl-canvas {
  outline: none;
}

.mapboxgl-ctrl-scale {
  font-weight: 700;
  font-family: var(--font);
}

.dark .mapboxgl-ctrl-scale {
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-group,
.dark .mapboxgl-ctrl-scale {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-icon {
  filter: invert(1);
}
</style>
