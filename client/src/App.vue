<script setup lang="ts">
import { onMounted } from 'vue'
import { useConfigStore } from './stores/settings.store'
import { useCommandService } from './services/command/command.service'

import Nav from '@/components/navigation/Navigation.vue'
import Palette from '@/components/palette/Palette.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'

const { theme, radius } = useConfigStore()
const commandService = useCommandService()

onMounted(() => {
  document.documentElement.style.setProperty('--radius', `${radius.value}rem`)
  document.documentElement.classList.add(`theme-${theme.value}`)

  commandService.bindAllHotkeysToCommands()
})
</script>

<template>
  <div class="flex h-dvh bg-background">
    <div class="flex flex-col justify-center">
      <Nav class="z-20" />
    </div>

    <div
      class="absolute top-1/2 left-1/2 transform -translate-x-1/2 p-2 z-10 w-1/2 max-w-[30rem]"
    >
      <HotkeysMenu />
    </div>

    <div
      class="absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 w-1/2 max-w-[30rem]"
    >
      <Palette class="h-fit" />
    </div>

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
