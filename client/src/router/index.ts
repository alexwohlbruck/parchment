import { createRouter, createWebHistory } from "vue-router";
import Map from "../views/Map.vue";

const routes = [
  {
    path: "/",
    name: "map",
    component: Map,
    children: [
      {
        path: "/place",
        name: "place",
        component: () => import("../views/Place.vue"),
      },
    ],
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("../views/settings/Settings.vue"),
    redirect: "/settings/behavior",
    children: [
      {
        path: "/settings/account",
        name: "account",
        component: () => import("../views/settings/Account.vue"),
      },
      {
        path: "/settings/behavior",
        name: "behavior",
        component: () => import("../views/settings/Behavior.vue"),
      },
      {
        path: "/settings/appearance",
        name: "appearance",
        component: () => import("../views/settings/Appearance.vue"),
      },
      {
        path: "/settings/map-data",
        name: "map-data",
        component: () => import("../views/settings/MapData.vue"),
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
