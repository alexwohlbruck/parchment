<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useAuthService } from '@/services/auth.service'
import { EyeIcon, XIcon } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const authService = useAuthService()
const expanded = ref(false)

async function returnToAdmin() {
  await authService.endImpersonation()
  router.push({ name: AppRoute.USERS })
}
</script>

<template>
  <Transition name="banner">
    <div
      v-if="authStore.isImpersonating"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
    >
      <button
        v-if="!expanded"
        class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-foreground/80 dark:bg-foreground/70 text-background text-xs font-medium backdrop-blur-sm shadow-lg cursor-pointer hover:bg-foreground/90 transition-all"
        @click="expanded = true"
      >
        <EyeIcon class="size-3" />
        {{ authStore.me?.firstName }}
      </button>
      <div
        v-else
        class="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-foreground/80 dark:bg-foreground/70 text-background text-xs font-medium backdrop-blur-sm shadow-lg"
      >
        <EyeIcon class="size-3 shrink-0" />
        <span>{{ authStore.me?.firstName }} {{ authStore.me?.lastName }}</span>
        <button
          class="text-background/80 hover:text-background underline cursor-pointer transition-colors"
          @click="returnToAdmin"
        >
          Exit
        </button>
        <button
          class="text-background/50 hover:text-background cursor-pointer transition-colors -mr-0.5"
          @click="expanded = false"
        >
          <XIcon class="size-3" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.banner-enter-active,
.banner-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
