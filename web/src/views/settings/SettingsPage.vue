<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useResponsive } from '@/lib/utils'

import { H4 } from '@/components/ui/typography'
import { Separator } from '@/components/ui/separator'
import Button from '@/components/ui/button/Button.vue'

import { ChevronLeftIcon } from 'lucide-vue-next'
import { onMounted } from 'vue'

const router = useRouter()
const { isMobileScreen } = useResponsive()

onMounted(() => {
  if (router.currentRoute.value.path === '/settings') {
    router.push('/settings/account')
  }
})
</script>

<template>
  <div class="flex-1 flex flex-col">
    <div v-if="isMobileScreen" class="flex flex-col gap-2">
      <div class="flex items-center gap-1 pt-2 pl-2">
        <Button @click="router.push('/settings')" variant="ghost" size="icon">
          <ChevronLeftIcon class="size-5" />
        </Button>
        <H4>
          {{ $t(`settings.${String(router.currentRoute.value.name)}.title`) }}
        </H4>
      </div>

      <Separator />
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto items-start px-4 md:pl-6">
      <div class="py-6 flex flex-col min-h-full" data-settings-scroll-content>
        <div class="w-full max-w-208 mx-auto flex-1 flex flex-col min-h-0">
          <router-view />
        </div>
      </div>
    </div>
  </div>
</template>
