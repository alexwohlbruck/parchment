<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
import { Spinner } from '@/components/ui/spinner'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import {
  MapIcon,
  BookMarkedIcon,
  MilestoneIcon,
  UsersRoundIcon,
  SettingsIcon,
} from 'lucide-vue-next'

const route = useRoute()
const themeStore = useThemeStore()
const commandService = useCommandService()
const authService = useAuthService()
const appStore = useAppStore()

const { dialogs } = appStore

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
    <div
      class="invisible sm:visible flex flex-col justify-center"
      v-if="route.meta?.layout === 'floating'"
    >
      <Nav class="z-20" />
    </div>

    <div
      class="invisible sm:visible absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 sm:max-w-[30rem] w-full"
    >
      <Palette class="h-fit" v-if="route.meta?.layout === 'floating'" />
    </div>

    <Card class="sm:invisible bg-muted absolute bottom-0 z-10 w-full">
      <div class="p-1 relative z-11">
        <Palette class="h-fit" v-if="route.meta?.layout === 'floating'" />
      </div>
      <Tabs default-value="account" class="w-full">
        <TabsList class="w-full h-14">
          <TabsTrigger class="flex-1 h-full" value="map">
            <MapIcon></MapIcon>
          </TabsTrigger>
          <TabsTrigger class="flex-1 h-full" value="search">
            <BookMarkedIcon></BookMarkedIcon>
          </TabsTrigger>
          <TabsTrigger class="flex-1 h-full" value="directions">
            <MilestoneIcon></MilestoneIcon>
          </TabsTrigger>
          <TabsTrigger class="flex-1 h-full" value="people">
            <UsersRoundIcon></UsersRoundIcon>
          </TabsTrigger>
          <TabsTrigger class="flex-1 h-full" value="settings">
            <SettingsIcon></SettingsIcon>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Card>

    <main class="flex-1 h-full">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>
