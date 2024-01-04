import { createRouter, createWebHistory } from "vue-router";
import Map from "../views/Map.vue";
const routes = [
  {
    path: "/",
    name: "Map",
    component: Map,
  },
  // {
  //   path: "/about",
  //   name: "About",
  //   // route level code-splitting
  //   // this generates a separate chunk (about.[hash].js) for this route
  //   // which is lazy-loaded when the route is visited.
  //   component: () =>
  //     import(/* webpackChunkName: "about" */ "../views/About.vue"),
  // },
];
const router = createRouter({
  history: createWebHistory(),
  routes,
});
export default router;
