import { createRouter, createWebHistory } from 'vue-router'

import Signin from '@/views/auth/Signin.vue'
import Map from '@/views/Map.vue'
import Directions from '@/views/directions/Directions.vue'
import Place from '@/views/Place.vue'
import Settings from '@/views/settings/Settings.vue'
import Account from '@/views/settings/pages/Account.vue'
import Behavior from '@/views/settings/pages/Behavior.vue'
import Appearance from '@/views/settings/pages/appearance/Appearance.vue'
import MapSettings from '@/views/settings/pages/MapSettings.vue'
import Users from '@/views/settings/pages/Users.vue'

import { useAuthStore } from '@/stores/auth.store'
import { useResponsive } from '@/lib/utils'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'

export enum AppRoute {
  SIGNIN = 'signin',
  MAP = 'map',
  PLACE = 'place',
  STREET = 'street',
  DIRECTIONS = 'directions',
  // SAVED = 'saved',
  SETTINGS = 'settings',
  ACCOUNT = 'account',
  BEHAVIOR = 'behavior',
  APPEARANCE = 'appearance',
  MAP_SETTINGS = 'mapSettings',
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
          component: Directions,
        },
        {
          path: '/place/:type/:id',
          name: AppRoute.PLACE,
          component: Place,
          meta: {
            bleedUnderPalette: true,
          },
        },
        // TODO: Support places from external sources
        // {
        //   path: '/place/external/:id',
        //   name: AppRoute.PLACE_EXTERNAL,
        //   component: () => import('../views/PlaceExternal.vue'),
        // },
      ],
    },
    {
      path: '/settings',
      components: {
        default: Map,
        dialogContent: Settings,
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
          component: Account,
        },
        {
          path: '/settings/behavior',
          name: AppRoute.BEHAVIOR,
          component: Behavior,
        },
        {
          path: '/settings/appearance',
          name: AppRoute.APPEARANCE,
          component: Appearance,
        },
        {
          path: '/settings/map',
          name: AppRoute.MAP_SETTINGS,
          component: MapSettings,
        },
        {
          path: '/settings/users',
          name: AppRoute.USERS,
          component: Users,
        },
      ],
    },
    {
      path: '/street/:id',
      name: AppRoute.STREET,
      component: Map,
      meta: {
        auth: true,
      },
      beforeEnter: async (to, from) => {
        const id = to.params.id
        if (!id) {
          return { name: AppRoute.MAP }
        }
      },
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
