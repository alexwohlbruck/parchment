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
    map.addSource("cycleosm", {
      type: "raster",
      tiles: [
        "https://a.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: '<a href="https://www.opencyclemap.org/">© OpenCycleMap</a>',
    });
    map.addLayer({
      id: "cycleosm-layer",
      type: "raster",
      source: "cycleosm",
      minzoom: 0,
      maxzoom: 22,
    });
  });
});

onUnmounted(() => {
  map.remove();
  map = null;
});
</script>
