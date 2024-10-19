import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import VueTransitions from '@morev/vue-transitions'
import { i18n } from '@/lib/i18n'

import '@morev/vue-transitions/styles'
import '@/styles/themes.css'

const app = createApp(App)
const pinia = createPinia()

app.use(router)
app.use(pinia)
app.use(i18n)
app.use(VueTransitions)

app.mount('#app')
