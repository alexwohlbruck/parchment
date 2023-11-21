<script setup lang="ts">
// import { RouterLink, RouterView } from 'vue-router'
import { ref, watch } from 'vue'
import NavigationMenu from './components/organisms/NavigationMenu.vue'
import { useMagicKeys } from '@vueuse/core'
import { useRouter } from 'vue-router'

const router = useRouter()

const visible = ref(false)
const keys = useMagicKeys()
const CmdK = keys['/']

watch(CmdK, (v) => {
  if (v) {
    router.push('/map/search')
  }
})
</script>

<template>
  <div class="flex gap-2 p-2" style="height: 100dvh">
    <NavigationMenu class="h-full z-2" />

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
