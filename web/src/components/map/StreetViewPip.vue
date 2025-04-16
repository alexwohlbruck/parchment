<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { Button } from '@/components/ui/button'
import { Maximize2Icon, XIcon } from 'lucide-vue-next'
import { TransitionExpand } from '@morev/vue-transitions'

const props = defineProps<{
  layout?: string
}>()

const emit = defineEmits<{
  'update:pipSwapped': [value: boolean]
}>()

const route = useRoute()
const router = useRouter()
const pipSwapped = ref(false)

function swapPip() {
  pipSwapped.value = !pipSwapped.value
  emit('update:pipSwapped', pipSwapped.value)
}
</script>

<template>
  <div
    class="w-full absolute right-0 z-12 p-2 flex flex-col gap-2 items-end pointer-events-none"
    :class="{
      'bottom-[calc(8.25rem+env(safe-area-inset-bottom))] md:bottom-0':
        props.layout === 'floating',
      'bottom-0': props.layout !== 'floating',
    }"
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
          @click="router.push({ name: AppRoute.MAP })"
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
