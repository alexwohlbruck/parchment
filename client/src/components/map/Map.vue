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

  // Add this vector style on load https://api.maptiler.com/maps/464b9344-6b19-4dfa-b274-acd791ec2943/style.json?key=UBdoOia18CaufO2hbWyZ
  map.on("load", function () {
    // Add MapTiler style as an overlay
    map.addSource("outdoor", {
      type: "vector",
      url: `https://api.maptiler.com/tiles/outdoor/tiles.json?key=${
        import.meta.env.VITE_MAPTILER_API_KEY
      }`,
    });

    map.addLayer({
      id: "Bicycle local",
      type: "line",
      slot: "middle",
      minzoom: 11,
      maxzoom: 22,
      source: "outdoor",
      "source-layer": "trail",
      layout: {
        "line-cap": "round",
        "line-join": "miter",
        visibility: "visible",
        "line-miter-limit": 3,
      },
      paint: {
        "line-color": "hsl(125, 49%, 40%)",
        "line-width": 3,
        "line-cap": "round",
        "line-emissive-strength": 1,
        "line-width": [
          "interpolate",
          ["exponential", 1],
          ["zoom"],
          11,
          0.5,
          13,
          2,
          18,
          3,
        ],
        "line-opacity": 1,
      },
      filter: [
        "all",
        ["==", "$type", "LineString"],
        ["==", "class", "bicycle"],
        ["!in", "network", "icn", "ncn"],
      ],
    });
  });
});

onUnmounted(() => {
  map.remove();
  map = null;
});
</script>
