import { createApp, effectScope } from 'vue'
import { createPinia } from 'pinia'
import { useGeolocationService } from '@/services/geolocation.service'
import { i18n } from '@/lib/i18n'
import './style.css'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import App from './App.vue'
import router from './router'
import VueTransitions from '@morev/vue-transitions'
import { MotionPlugin } from '@vueuse/motion'
import VueVirtualScroller from 'vue-virtual-scroller'
import { initVaulChromeWorkaround } from '@/lib/vaul-chrome-workaround'
import { setupPWA } from '@/lib/pwa'
import { prefetchRouteChunks } from '@/lib/router-chunk-prefetch'
import '@/services/library/sync-bootstrap'

import '@morev/vue-transitions/styles'
import '@/styles/themes.css'

// TODO: Move to dedicated file
// import 'mapillary-js/dist/mapillary.css'
import 'mapillary-js/dist/mapillary.css'

const app = createApp(App)
const pinia = createPinia()

app.use(router)
app.use(pinia)
app.use(i18n)
app.use(VueTransitions)
app.use(MotionPlugin)
app.use(VueVirtualScroller)

initVaulChromeWorkaround()
// Dev-only GPX track simulator. Dynamically imported so `@/dev/` never enters
// the production graph. To remove the feature: delete this block and
// `web/src/dev/gpx-simulator/`.
if (import.meta.env.DEV) {
  void import('@/dev/gpx-simulator').then(({ install }) => install())
}

// Start geolocation as early as possible — before any component mounts
effectScope().run(() => useGeolocationService())

void setupPWA()

app.mount('#app')

// Pull the lazily-loaded views in while there's a connection, so they can
// still be opened once there isn't.
prefetchRouteChunks(router)
