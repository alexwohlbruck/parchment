<script setup lang="ts">
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/settings/theme.store'
import { useCommandService } from '@/services/command.service'
import { useAuthService } from '@/services/auth.service'

import Nav from '@/components/navigation/Navigation.vue'
import Palette from '@/components/palette/Palette.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'

const themeStore = useThemeStore()
const commandService = useCommandService()
const authService = useAuthService()

onMounted(() => {
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
  authService.getAuthenticatedUser()
})
</script>

<template>
  <div class="flex h-dvh bg-background">
    <div class="flex flex-col justify-center">
      <Nav class="z-20" />
    </div>

    <HotkeysMenu />

    <div
      class="absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 w-1/2 max-w-[30rem]"
    >
      <Palette class="h-fit" />
    </div>

    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>
