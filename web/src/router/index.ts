import { createRouter, createWebHistory } from 'vue-router'

import Signin from '@/views/auth/Signin.vue'
import Map from '@/views/Map.vue'
import Directions from '@/views/directions/Directions.vue'
import Place from '@/views/place/Place.vue'
import Settings from '@/views/settings/Settings.vue'
import Account from '@/views/settings/pages/Account.vue'
import Behavior from '@/views/settings/pages/Behavior.vue'
import Appearance from '@/views/settings/pages/appearance/Appearance.vue'
import MapSettings from '@/views/settings/pages/MapSettings.vue'
import Users from '@/views/settings/pages/Users.vue'
import Library from '@/views/library/Library.vue'
import Collection from '@/views/library/Collection.vue'
import NotFound from '@/views/NotFound.vue'
import SavedPlaces from '@/views/library/SavedPlaces.vue'
import Collections from '@/views/library/Collections.vue'

import { useAuthStore } from '@/stores/auth.store'

export enum AppRoute {
  SIGNIN = 'signin',
  MAP = 'map',
  PLACE = 'place',
  PLACE_PROVIDER = 'place-provider',
  PLACE_LOCATION = 'place-location',
  STREET = 'street',
  DIRECTIONS = 'directions',
  LIBRARY = 'library',
  LIBRARY_PLACES = 'library-places',
  LIBRARY_COLLECTIONS = 'library-collections',
  LIBRARY_ROUTES = 'library-routes',
  LIBRARY_LAYERS = 'library-layers',
  LIBRARY_MAPS = 'library-maps',
  COLLECTION = 'collection',
  SETTINGS = 'settings',
  ACCOUNT = 'account',
  BEHAVIOR = 'behavior',
  APPEARANCE = 'appearance',
  MAP_SETTINGS = 'mapSettings',
  USERS = 'users',
  NOT_FOUND = 'not-found',
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
        },
        {
          path: '/place/provider/:provider/:placeId',
          name: AppRoute.PLACE_PROVIDER,
          component: Place,
        },
        {
          path: '/place/location/:name/:lat/:lng',
          name: AppRoute.PLACE_LOCATION,
          component: Place,
        },
        {
          path: '/library',
          name: AppRoute.LIBRARY,
          component: Library,
          redirect: { name: AppRoute.LIBRARY_PLACES },
          meta: {
            auth: true,
          },
          children: [
            {
              path: 'places',
              name: AppRoute.LIBRARY_PLACES,
              component: SavedPlaces,
            },
            {
              path: 'collections',
              name: AppRoute.LIBRARY_COLLECTIONS,
              component: Collections,
            },
            {
              path: 'routes',
              name: AppRoute.LIBRARY_ROUTES,
              component: () => import('@/views/library/EmptyTab.vue'),
            },
            {
              path: 'layers',
              name: AppRoute.LIBRARY_LAYERS,
              component: () => import('@/views/library/EmptyTab.vue'),
            },
            {
              path: 'maps',
              name: AppRoute.LIBRARY_MAPS,
              component: () => import('@/views/library/EmptyTab.vue'),
            },
          ],
        },
        {
          path: '/library/collections/:id',
          name: AppRoute.COLLECTION,
          component: Collection,
          props: true,
        },
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
    {
      path: '/:pathMatch(.*)*',
      name: AppRoute.NOT_FOUND,
      component: NotFound,
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
