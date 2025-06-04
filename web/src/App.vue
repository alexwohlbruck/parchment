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
import DialogView from '@/views/DialogView.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'
import { Toaster } from '@/components/ui/sonner'
import { TransitionSlide } from '@morev/vue-transitions'

const route = useRoute()
const themeStore = useThemeStore()
const commandService = useCommandService()
const authService = useAuthService()
const appStore = useAppStore()
const { isMobileScreen } = useResponsive()

const { dialogs } = appStore
const navMini = ref(true)
const viewRef = ref()

const isFloatingLayout = computed(() => route.meta?.layout === 'floating')

onMounted(() => {
  // TODO: Use maplibre if not authed or not on paid plan
  authService.getAuthenticatedUser()
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
})
</script>

<template>
  <!-- Popups and modals -->
  <Toaster richColors closeButton :duration="7000" position="bottom-center" />
  <HotkeysMenu />
  <DialogView></DialogView>
  <div v-for="dialog in dialogs" :key="dialog.id">
    <component
      :is="dialog.component"
      v-bind="dialog.props"
      @submit="async e => dialog.onSubmit(await e)"
    />
  </div>

  <div class="flex flex-row h-dvh bg-background items-stretch">
    <!-- Desktop navigation -->
    <template v-if="!isMobileScreen">
      <transition-slide
        no-opacity
        :offset="['-130%', 0]"
        @after-enter="viewRef?.onNavTransitionComplete"
      >
        <DesktopNav
          v-if="isFloatingLayout"
          v-model:mini="navMini"
          class="z-40 h-full"
        />
      </transition-slide>
    </template>

    <!-- Mobile navigation -->
    <template v-else>
      <transition-slide
        no-opacity
        :offset="[0, '130%']"
        @after-enter="viewRef?.onNavTransitionComplete"
      >
        <MobileNav v-if="isFloatingLayout" class="z-20" />
      </transition-slide>
    </template>

    <!-- Main content -->
    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" ref="viewRef" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.debug-rect {
  border: 2px dashed rgba(255, 0, 0, 0.7);
  background-color: rgba(255, 0, 0, 0.1);
}
</style>
