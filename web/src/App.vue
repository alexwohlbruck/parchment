<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/settings/theme.store'
import { useCommandService } from '@/services/command.service'
import { useAuthService } from '@/services/auth.service'
import { useResponsive } from '@/lib/utils'

import DesktopNav from '@/components/navigation/DesktopNavigation.vue'
import MobileNav from '@/components/navigation/MobileNavigation.vue'
import Palette from '@/components/palette/Palette.vue'
import DialogView from '@/views/DialogView.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import { P } from '@/components/ui/typography'

const route = useRoute()
const themeStore = useThemeStore()
const commandService = useCommandService()
const authService = useAuthService()
const appStore = useAppStore()
const { isMobileScreen } = useResponsive()

const { dialogs } = appStore

const isFloatingLayout = computed(() => route.meta?.layout === 'floating')

// Detect if Render server is starting from cold start. This is common with the free plan,
// so we will show a loading screen while the server spins up.
const requestReceived = ref(false)
const serversSpinning = ref(false)

onMounted(() => {
  setTimeout(() => {
    if (!requestReceived.value) {
      serversSpinning.value = true
    }
  }, 1000)
  authService.getAuthenticatedUser().then(() => {
    requestReceived.value = true
    serversSpinning.value = false
  })
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
})
</script>

<template>
  <AlertDialog :open="serversSpinning">
    <AlertDialogContent class="flex flex-col items-center gap-2">
      <Spinner size="lg" color="primary" />
      <P>Spinning servers...</P>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Popups and modals -->
  <Toaster richColors closeButton :duration="7000" position="bottom-center" />
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
    <!-- Desktop layout -->
    <template v-if="!isMobileScreen">
      <div class="flex flex-col justify-center" v-if="isFloatingLayout">
        <DesktopNav class="z-20" />
      </div>

      <div
        class="absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 sm:max-w-[30rem] w-full"
      >
        <Palette class="h-fit" v-if="isFloatingLayout" />
      </div>
    </template>

    <!-- Mobile layout -->
    <template v-else>
      <MobileNav v-if="isFloatingLayout" />
    </template>

    <main class="flex-1 h-full">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>
