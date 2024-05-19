<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const router = useRouter()

const modalOpen = ref(false)

router.beforeEach((to, from) => {
  const newRouteIsModal = !!to.meta?.modal || false
  modalOpen.value = newRouteIsModal
})

watch(modalOpen, open => {
  if (!open) {
    router.push({ name: AppRoute.MAP })
  }
})
</script>

<template>
  <Dialog :open="modalOpen" @update:open="open => (modalOpen = open)">
    <DialogContent class="overflow-y-auto h-[90vh] max-w-[80vw]">
      <router-view name="modalContent"></router-view>
    </DialogContent>
  </Dialog>
</template>
