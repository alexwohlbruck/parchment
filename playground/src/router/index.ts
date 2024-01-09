import { createRouter, createWebHistory } from 'vue-router'
import MapView from '../views/MapView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/map',
      name: 'map',
      component: MapView,
      children: [
        {
          path: 'search',
          name: 'search',
          component: () => import('../views/SearchView.vue')
        },
        {
          path: 'place',
          name: 'place',
          component: () => import('../views/PlaceView.vue')
        }
      ]
    },

    {
      path: '/settings',
      name: 'settings',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/SettingsView.vue')
    }
  ]
})

export default router
