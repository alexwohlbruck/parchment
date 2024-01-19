import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import VueTransitions from "@morev/vue-transitions";
import globalFilters from "@/filters/global.filters";

import "@morev/vue-transitions/styles";
import "mapbox-gl/dist/mapbox-gl.css";
import "@/styles/themes.css";

const app = createApp(App);
const pinia = createPinia();

app.config.globalProperties.$filters = globalFilters;

app.use(router);
app.use(pinia);
app.use(VueTransitions);

app.mount("#app");
