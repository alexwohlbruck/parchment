<!--
  Building lighting, as a panel over the live map — DEV ONLY.

  The same levers as the Developer settings section, in a frame that does not
  cover what they change. Opened from that section; closing it here clears the
  flag, so it does not reappear on the next navigation.

  Draggable by its header, because the one spot worth watching is often exactly
  where a fixed panel would sit.
-->

<script setup lang="ts">
import { ref } from 'vue'
import { XIcon, RotateCcwIcon, GripHorizontalIcon } from 'lucide-vue-next'
import {
  useBuildingShadeTuner,
  SHADE_GROUPS,
  SHADE_POPOVER_KEY,
} from '@/composables/useBuildingShadeTuner'

const { state, toggles, isMaplibre, copied, setLever, reset, copyDefaults } = useBuildingShadeTuner()

const open = ref(true)
const pos = ref({ x: window.innerWidth - 340, y: 88 })

function close() {
  sessionStorage.removeItem(SHADE_POPOVER_KEY)
  open.value = false
}

/** Drag by the header. Pointer capture keeps it tracking over the map canvas. */
function startDrag(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const from = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y }
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    pos.value = {
      x: Math.min(Math.max(ev.clientX - from.x, 0), window.innerWidth - 300),
      y: Math.min(Math.max(ev.clientY - from.y, 0), window.innerHeight - 60),
    }
  }
  const up = () => {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<template>
  <div
    v-if="open && isMaplibre"
    class="fixed z-[60] w-[19rem] rounded-xl border border-border bg-background/95 text-sm shadow-lg backdrop-blur"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
  >
    <div
      class="flex cursor-grab touch-none items-center gap-2 px-3 py-2 active:cursor-grabbing"
      @pointerdown="startDrag"
    >
      <GripHorizontalIcon class="size-4 text-muted-foreground" />
      <span class="flex-1 font-medium">Building lighting</span>
      <button class="text-muted-foreground hover:text-foreground" @click="close">
        <XIcon class="size-4" />
      </button>
    </div>

    <div class="max-h-[70vh] overflow-y-auto px-3 pb-3">
      <label class="mb-2 flex items-center justify-between">
        <span>Enabled</span>
        <input v-model="toggles.enabled" type="checkbox" />
      </label>

      <div v-for="group in SHADE_GROUPS" :key="group.title" class="mt-3">
        <div class="mb-1 text-xs text-muted-foreground">{{ group.title }}</div>

        <label v-if="group.toggle" class="mb-1 flex items-center justify-between">
          <span>{{ group.toggle.label }}</span>
          <input v-model="toggles[group.toggle.key]" type="checkbox" />
        </label>

        <div v-for="lever in group.levers" :key="lever.key" class="mb-1.5">
          <div class="flex items-center justify-between text-xs">
            <span>{{ lever.label }}</span>
            <span class="tabular-nums text-muted-foreground">
              {{ lever.format ? lever.format(state[lever.key]) : Math.round(state[lever.key]) }}
            </span>
          </div>
          <input
            class="w-full accent-primary"
            type="range"
            :min="lever.min"
            :max="lever.max"
            :step="lever.step"
            :value="state[lever.key]"
            @input="setLever(lever.key, [Number(($event.target as HTMLInputElement).value)])"
          />
        </div>
      </div>

      <div class="mt-3 flex gap-2">
        <button
          class="flex-1 rounded-md border border-border px-2 py-1.5 hover:bg-muted"
          @click="reset"
        >
          <RotateCcwIcon class="mr-1 inline size-3.5" />
          Reset
        </button>
        <button
          class="flex-1 rounded-md bg-primary px-2 py-1.5 text-primary-foreground"
          @click="copyDefaults"
        >
          {{ copied ? 'Copied' : 'Copy defaults' }}
        </button>
      </div>
    </div>
  </div>
</template>
