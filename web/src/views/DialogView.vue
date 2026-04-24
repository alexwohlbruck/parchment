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

/**
 * Reka-ui's Dialog closes on any "interaction outside" — including
 * clicks / focus moves into the Sonner toast portal that sits as a
 * sibling of this dialog. Without this guard, tapping a toast's
 * action button, swiping one to dismiss, or clicking the close × on
 * a toast all bubble back to the dialog as outside interactions and
 * kick the user back to the map.
 *
 * We treat anything inside `[data-sonner-toaster]` as "still inside"
 * for close-intent purposes.
 */
function isTargetInsideToast(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('[data-sonner-toaster]')
}

function onPointerDownOutside(event: Event) {
  const original = (event as CustomEvent<{ originalEvent: Event }>).detail
    ?.originalEvent
  if (isTargetInsideToast(original?.target ?? null)) event.preventDefault()
}

function onFocusOutside(event: Event) {
  const original = (event as CustomEvent<{ originalEvent: Event }>).detail
    ?.originalEvent
  if (isTargetInsideToast(original?.target ?? null)) event.preventDefault()
}
</script>

<template>
  <Dialog :open="dialogOpen" @update:open="open => (dialogOpen = open)">
    <DialogContent
      no-padding
      show-close-button
      class="overflow-y-auto h-full sm:h-[90vh] max-w-full sm:max-w-[80vw] pt-[env(safe-area-inset-top)] border-none md:border"
      @pointer-down-outside="onPointerDownOutside"
      @focus-outside="onFocusOutside"
    >
      <router-view name="dialogContent"></router-view>
    </DialogContent>
  </Dialog>
</template>
