<script setup lang="ts">
import Nav from '@/components/navigation/Navigation.vue'
import { onMounted } from 'vue'
import { useConfigStore } from './stores/settings.store'
import { useCommandService } from './services/command/command.service'

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

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
