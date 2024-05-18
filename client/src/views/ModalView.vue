<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const router = useRouter()

const modalOpen = ref(false)
const defaultView = ref<string | null>(null)

// If opening a modal page, remember the path to restore when modal closes
router.beforeEach((to, from) => {
  const oldRouteIsModal = !!from.meta?.modal || false
  const newRouteIsModal = !!to.meta?.modal || false
  modalOpen.value = newRouteIsModal
  if (!oldRouteIsModal && newRouteIsModal) {
    defaultView.value = (from.path as string) || null
  }
})

watch(modalOpen, open => {
  if (!open) {
    router.push(defaultView.value || { name: AppRoute.MAP })
  }
})
</script>

<template>
  <Dialog :open="modalOpen" @update:open="open => (modalOpen = open)">
    <DialogContent class="overflow-y-auto h-[90vh] max-w-[80vw]">
      <router-view name="content"></router-view>
    </DialogContent>
  </Dialog>
</template>
