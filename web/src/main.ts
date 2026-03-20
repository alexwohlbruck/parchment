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

// Start geolocation as early as possible — before any component mounts
effectScope().run(() => useGeolocationService())

app.mount('#app')
