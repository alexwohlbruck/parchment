<script setup lang="ts">
// import { RouterLink, RouterView } from 'vue-router'
import { ref, watch } from 'vue'
import NavigationMenu from './components/organisms/NavigationMenu.vue'
import { useMagicKeys } from '@vueuse/core'

const visible = ref(false)
const keys = useMagicKeys()
const CmdK = keys['/']

watch(CmdK, (v) => {
  if (v) {
    console.log('Meta + K has been pressed')
    visible.value = true
  }
})

import CommandPalette from './components/organisms/CommandPalette.vue'
</script>

<template>
  <div class="flex gap-2" style="height: 100dvh">
    <NavigationMenu class="h-full" :class="{ 'absolute z-1': $route.path.includes('map') }" />

    <main class="flex-1">
      <RouterView />
    </main>
  </div>

  <CommandPalette
    :visible="visible"
    @update:visible="
      (newValue) => {
        console.log(newValue)
        visible = newValue
      }
    "
  />
</template>
