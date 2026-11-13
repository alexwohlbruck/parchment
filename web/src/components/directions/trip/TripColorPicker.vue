<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDownIcon } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PROFILE_TABS, type RouteProfileType } from '@/lib/directions/route-profile-colors'
import { tripProfiles, type StripSegment } from '@/lib/directions/trip-strip'

const props = defineProps<{ segments: StripSegment[] }>()
const colorBy = defineModel<RouteProfileType | null>({ default: null })

const MODE = 'mode'
const options = computed(() => tripProfiles(props.segments).map(id => PROFILE_TABS.find(t => t.id === id)!))
const selected = computed({
  get: () => colorBy.value ?? MODE,
  set: (v: string) => { colorBy.value = v === MODE ? null : (v as RouteProfileType) },
})
const label = computed(() => options.value.find(o => o.id === colorBy.value)?.label ?? 'Travel mode')
</script>

<template>
  <DropdownMenu v-if="options.length">
    <DropdownMenuTrigger
      class="relative -my-1 inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-xs after:absolute after:-inset-x-3 after:-inset-y-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      Color by <span class="ml-0.5 text-foreground">{{ label }}</span>
      <ChevronDownIcon class="size-3" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="center" class="w-44">
      <DropdownMenuRadioGroup v-model="selected">
        <DropdownMenuRadioItem :value="MODE">Travel mode</DropdownMenuRadioItem>
        <DropdownMenuRadioItem v-for="option in options" :key="option.id" :value="option.id">
          {{ option.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
