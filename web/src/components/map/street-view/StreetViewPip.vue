<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useResponsive } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Maximize2Icon, XIcon } from 'lucide-vue-next'
import { TransitionExpand } from '@morev/vue-transitions'

// Two-way bound to Map.vue. Must be a model (not a local ref) so it reflects
// the parent setting it true when street view opens — otherwise the first swap
// emits a value the parent already has and appears to do nothing.
const pipSwapped = defineModel<boolean>('pipSwapped', { default: false })

const route = useRoute()
const router = useRouter()
const { isMobileScreen } = useResponsive()

// Street view is a full-screen takeover (route meta `hideUI`). The pip moves to
// the top on mobile so it doesn't cover the imagery's bottom navigation.
const hideUI = computed(() => !!route.meta?.hideUI)

function swapPip() {
  pipSwapped.value = !pipSwapped.value
}

// Closing returns to wherever street view was opened from (e.g. the place
// detail). Fall back to the map root when there's no history to go back to
// (e.g. street view reached via a direct deep link).
function closeStreetView() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push({ name: AppRoute.MAP })
  }
}
</script>

<template>
  <!--
    In street view (hideUI) on mobile the pip sits at the TOP so it doesn't
    cover the street imagery's bottom navigation. On desktop it stays bottom.
  -->
  <div
    class="w-full absolute right-0 z-12 p-2 flex flex-col gap-2 items-end pointer-events-none"
    :class="
      hideUI
        ? isMobileScreen
          ? 'top-[env(safe-area-inset-top)]'
          : 'bottom-0'
        : 'bottom-[calc(8.25rem+env(safe-area-inset-bottom))] md:bottom-0'
    "
  >
    <TransitionExpand>
      <div
        v-if="route.name === AppRoute.STREET"
        id="pipContent"
        class="pointer-events-auto shadow-md aspect-video rounded-lg overflow-hidden relative transition-width duration-300"
        :class="
          pipSwapped
            ? 'w-full sm:w-[40vw] md:w-[30vw]'
            : 'w-full sm:w-[50vw] md:w-[40vw]'
        "
      >
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white hover:text-white z-10"
          @click="closeStreetView"
        >
          <XIcon class="size-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="absolute top-1 left-1 bg-black/50 hover:bg-black/70 text-white hover:text-white z-10"
          @click="swapPip()"
        >
          <Maximize2Icon class="size-5 rotate-90" />
        </Button>

        <slot />
      </div>
    </TransitionExpand>
  </div>
</template>
