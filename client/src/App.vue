<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/settings/theme.store'
import { useCommandService } from '@/services/command.service'
import { useAuthService } from '@/services/auth.service'

import Nav from '@/components/navigation/Navigation.vue'
import Palette from '@/components/palette/Palette.vue'
import DialogView from '@/views/DialogView.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'
import { Toaster } from '@/components/ui/sonner'

const route = useRoute()
const themeStore = useThemeStore()
const commandService = useCommandService()
const authService = useAuthService()
const appStore = useAppStore()

const { dialogs, removeDialog } = appStore

onMounted(() => {
  authService.getAuthenticatedUser()
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
})
</script>

<template>
  <!-- Popups and modals -->
  <Toaster richColors closeButton />
  <HotkeysMenu />
  <DialogView></DialogView>

  <div v-for="dialog in dialogs" :key="dialog.id">
    <component
      :is="dialog.component"
      v-bind="dialog.props"
      @submit="dialog.onSubmit($event)"
    />
  </div>

  <div class="flex h-dvh bg-background">
    <div
      class="flex flex-col justify-center"
      v-if="route.meta?.layout === 'floating'"
    >
      <Nav class="z-20" />
    </div>

    <div
      class="absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 w-1/2 max-w-[30rem]"
    >
      <Palette class="h-fit" v-if="route.meta?.layout === 'floating'" />
    </div>

    <main class="flex-1 h-full">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>
