import { createRouter, createWebHistory } from "vue-router";
import Map from "../views/Map.vue";

const routes = [
  {
    path: "/map",
    name: "Map",
    component: Map,
    children: [
      {
        path: "search",
        name: "Search",
        component: () => import("../views/Search.vue"),
      },
      {
        path: "place",
        name: "Place",
        component: () => import("../views/Place.vue"),
      },
    ],
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("../views/Settings.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
