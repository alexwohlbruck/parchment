import { createRouter, createWebHistory } from "vue-router";
import Map from "../views/Map.vue";

const routes = [
  {
    path: "/",
    name: "map",
    component: Map,
    children: [
      {
        path: "place",
        name: "place",
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
