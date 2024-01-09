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
});

onUnmounted(() => {
  map.remove();
  map = null;
});
</script>
