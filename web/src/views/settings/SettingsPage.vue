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
  <div class="flex-1 flex flex-col gap-4">
    <div class="flex items-center gap-1">
      <Button
        v-if="isMobileScreen"
        @click="router.push('/settings')"
        variant="ghost"
        size="icon"
      >
        <ChevronLeftIcon class="size-5" />
      </Button>
      <H4 class="pb-[.25rem]">
        {{ $t(`settings.${String(router.currentRoute.value.name)}.title`) }}
      </H4>
    </div>

    <Separator />

    <div class="overflow-y-auto items-start">
      <router-view class="w-full max-w-[52rem]" />
    </div>
  </div>
</template>
