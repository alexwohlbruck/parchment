import { createRouter, createWebHistory } from 'vue-router'

import Signin from '@/views/auth/Signin.vue'
import Map from '@/views/Map.vue'
import { useAuthStore } from '@/stores/auth.store'

export enum AppRoute {
  SIGNIN = 'signin',
  MAP = 'map',
  PLACE = 'place',
  SETTINGS = 'settings',
  ACCOUNT = 'account',
  BEHAVIOR = 'behavior',
  APPEARANCE = 'appearance',
  MAP_DATA = 'mapData',
}

function keepDefaultView(to, from) {
  if (from.matched.length) {
    to.matched[0].components.default = from.matched[0].components.default
  } else {
    to.matched[0].components.default = Map
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
          path: '/place',
          name: AppRoute.PLACE,
          component: () => import('../views/Place.vue'),
        },
      ],
    },
    {
      path: '/settings',
      components: {
        content: () => import('../views/settings/Settings.vue'),
      },
      meta: {
        auth: true,
        modal: true,
        layout: 'floating',
      },
      beforeEnter: [keepDefaultView],
      redirect: '/settings/appearance',
      children: [
        {
          path: '/settings/account',
          name: AppRoute.ACCOUNT,
          component: () => import('../views/settings/Account.vue'),
        },
        {
          path: '/settings/behavior',
          name: AppRoute.BEHAVIOR,
          component: () => import('../views/settings/Behavior.vue'),
        },
        {
          path: '/settings/appearance',
          name: AppRoute.APPEARANCE,
          component: () =>
            import('../views/settings/appearance/Appearance.vue'),
        },
        {
          path: '/settings/map-data',
          name: AppRoute.MAP_DATA,
          component: () => import('../views/settings/MapData.vue'),
        },
      ],
    },
  ],
})

router.beforeEach((to, from) => {
  const authStore = useAuthStore()
  if (to.name !== AppRoute.SIGNIN) authStore.attemptPath(to.path)
  if (to.meta.auth && !authStore.me) {
    return {
      name: AppRoute.SIGNIN,
    }
  }
})

export default router
