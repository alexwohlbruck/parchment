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
  serversSpinning.value = true
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

  <!-- Add absolute positioned palette container -->
  <div
    v-if="!isMobileScreen && isFloatingLayout"
    class="fixed m-2 left-[3.25rem] z-20 w-[24rem] w-full"
  >
    <transition-slide no-opacity :offset="[0, '-130%']">
      <Palette class="h-fit" />
    </transition-slide>
  </div>

  <div class="flex flex-row h-dvh bg-background items-stretch">
    <template v-if="!isMobileScreen">
      <transition-slide no-opacity :offset="['-130%', 0]">
        <DesktopNav v-if="isFloatingLayout" class="z-20 h-full" />
      </transition-slide>
    </template>

    <template v-else>
      <transition-slide no-opacity :offset="[0, '130%']">
        <MobileNav v-if="isFloatingLayout" />
      </transition-slide>
    </template>

    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>
