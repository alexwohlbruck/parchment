<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const router = useRouter()

const dialogOpen = ref(false)

router.beforeEach((to, from) => {
  dialogOpen.value = !!to.meta?.dialog || false
})

watch(dialogOpen, open => {
  if (!open) {
    router.push({ name: AppRoute.MAP })
  }
})
</script>

<template>
  <Dialog :open="dialogOpen" @update:open="open => (dialogOpen = open)">
    <DialogContent
      no-padding
      class="overflow-y-auto h-full sm:h-[90vh] max-w-full sm:max-w-[80vw]"
    >
      <router-view name="dialogContent"></router-view>
    </DialogContent>
  </Dialog>
</template>
