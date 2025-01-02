import { createRouter, createWebHistory } from 'vue-router'

import Signin from '@/views/auth/Signin.vue'
import Map from '@/views/Map.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useResponsive } from '@/lib/utils'

export enum AppRoute {
  SIGNIN = 'signin',
  MAP = 'map',
  DIRECTIONS = 'directions',
  PLACE = 'place',
  SETTINGS = 'settings',
  ACCOUNT = 'account',
  BEHAVIOR = 'behavior',
  APPEARANCE = 'appearance',
  MAP_DATA = 'mapData',
  USERS = 'users',
}

function keepDefaultView(to, from) {
  if (from.matched.length) {
    to.matched[0].components.default = from.matched[0].components.default
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/signin',
      name: AppRoute.SIGNIN,
      component: Signin,
    },
    {
      path: '/',
      name: AppRoute.MAP,
      component: Map,
      meta: {
        layout: 'floating',
        auth: true,
      },
      children: [
        {
          path: '/directions',
          name: AppRoute.DIRECTIONS,
          component: () => import('../views/directions/Directions.vue'),
        },
        {
          path: '/place',
          name: AppRoute.PLACE,
          component: () => import('../views/Place.vue'),
        },
      ],
    },
    {
      path: '/settings',
      components: {
        default: Map,
        dialogContent: () => import('../views/settings/Settings.vue'),
      },
      meta: {
        auth: true,
        dialog: true,
        layout: 'floating',
      },
      beforeEnter: [keepDefaultView],
      children: [
        {
          path: '/settings/account',
          name: AppRoute.ACCOUNT,
          component: () => import('../views/settings/pages/Account.vue'),
        },
        {
          path: '/settings/behavior',
          name: AppRoute.BEHAVIOR,
          component: () => import('../views/settings/pages/Behavior.vue'),
        },
        {
          path: '/settings/appearance',
          name: AppRoute.APPEARANCE,
          component: () =>
            import('../views/settings/pages/appearance/Appearance.vue'),
        },
        {
          path: '/settings/map-data',
          name: AppRoute.MAP_DATA,
          component: () => import('../views/settings/pages/MapData.vue'),
        },
        {
          path: '/settings/users',
          name: AppRoute.USERS,
          component: () => import('../views/settings/pages/Users.vue'),
        },
      ],
    },
  ],
})

router.beforeEach(async (to, from) => {
  const authStore = useAuthStore()
  if (to.name !== AppRoute.SIGNIN) authStore.stashPath(to.path)
  if (to.meta.auth) {
    // Wait for current user response to come back before checking auth
    if (authStore.me === undefined) await authStore.authenticatedUserPromise
    if (!authStore.me)
      return {
        name: AppRoute.SIGNIN,
      }
  }
})

export default router
