<template>
  <div ref="mapContainer"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  Marker,
  Popup,
  Layer,
  Source,
  LngLatBounds,
  LngLat,
} from "mapbox-gl";
import layers from "./layers";

const projection = localStorage.getItem("projection") || "globe";

const router = useRouter();

const mapContainer = ref(null);
let map = null;

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
    container: mapContainer.value,
    style: "mapbox://styles/mapbox/standard-beta",
    center: [lng, lat],
    bearing,
    pitch,
    zoom,
    attributionControl: false,
    projection,
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
    Object.entries(layers).forEach(([key, layerType]) => {
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
        });
      });
    });
  });
});

onUnmounted(() => {
  map.remove();
  map = null;
});
</script>
