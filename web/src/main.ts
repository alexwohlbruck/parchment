import { createApp, effectScope } from 'vue'
import { createPinia } from 'pinia'
import { useGeolocationService } from '@/services/geolocation.service'
import { i18n } from '@/lib/i18n'
import './style.css'
import App from './App.vue'
import router from './router'
import VueTransitions from '@morev/vue-transitions'
import { MotionPlugin } from '@vueuse/motion'
import VueVirtualScroller from 'vue-virtual-scroller'
import { initVaulChromeWorkaround } from '@/lib/vaulChromeWorkaround'
import { install as installGpxSimulator } from '@/dev/gpx-simulator'

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

// Dev-only GPX track simulator. Static import (no top-level await — TLA
// here delays app.mount enough to break the initial layout pass on `/`).
// The conditional call is dead-code eliminated in production; the
// import remains in the prod bundle but the module is side-effect-free
// so an unused-export tree-shake removes it.
//
// To remove this feature entirely: delete the import line above, this
// block, AND the `web/src/dev/gpx-simulator/` directory. No other
// touches needed — the simulator is fully decoupled from app code.
if (import.meta.env.DEV) {
  installGpxSimulator()
}

// Start geolocation as early as possible — before any component mounts
effectScope().run(() => useGeolocationService())

app.mount('#app')
