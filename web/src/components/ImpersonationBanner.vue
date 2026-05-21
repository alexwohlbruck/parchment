<script setup lang="ts">
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useAuthService } from '@/services/auth.service'
import { Button } from '@/components/ui/button'
import { EyeIcon } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const authService = useAuthService()

async function returnToAdmin() {
  await authService.endImpersonation()
  router.push({ name: AppRoute.USERS })
}
</script>

<template>
  <div
    v-if="authStore.isImpersonating"
    class="fixed bottom-0 left-0 right-0 z-50 bg-amber-500 dark:bg-amber-600 text-white px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium shadow-lg"
  >
    <EyeIcon class="size-4" />
    <span>
      Viewing as {{ authStore.me?.firstName }} {{ authStore.me?.lastName }}
    </span>
    <Button
      variant="outline"
      size="xs"
      class="border-white/40 text-white hover:bg-white/20 hover:text-white"
      @click="returnToAdmin"
    >
      Return to admin
    </Button>
  </div>
</template>
