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
  <NavigationMenu />

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
