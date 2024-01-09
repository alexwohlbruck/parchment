import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import VueTransitions from "@morev/vue-transitions";

import "@morev/vue-transitions/styles";
import "mapbox-gl/dist/mapbox-gl.css";

createApp(App).use(router).use(VueTransitions).mount("#app");
