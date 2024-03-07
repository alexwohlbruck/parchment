import { createRouter, createWebHistory } from 'vue-router'
import Map from '../views/Map.vue'

const routes = [
  {
    path: '/',
    name: 'Map',
    component: Map,
    children: [
      {
        path: '/place',
        name: 'Place',
        component: () => import('../views/Place.vue'),
      },
    ],
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/settings/Settings.vue'),
    redirect: '/settings/appearance',
    children: [
      {
        path: '/settings/account',
        name: 'Account',
        component: () => import('../views/settings/Account.vue'),
      },
      {
        path: '/settings/behavior',
        name: 'Behavior',
        component: () => import('../views/settings/Behavior.vue'),
      },
      {
        path: '/settings/appearance',
        name: 'Appearance',
        component: () => import('../views/settings/appearance/Appearance.vue'),
      },
      {
        path: '/settings/map-data',
        name: 'Map data',
        component: () => import('../views/settings/MapData.vue'),
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
