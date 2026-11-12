<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDownIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PROFILE_TABS, type RouteProfileType } from '@/lib/directions/route-profile-colors'
import { profileStats, profileSummary } from '@/lib/directions/route-profile-stats'
import { canColorBy, tripProfiles, type StripSegment } from '@/lib/directions/trip-strip'

const props = defineProps<{ segments: StripSegment[] }>()
const colorBy = defineModel<RouteProfileType | null>({ default: null })

const MODE = 'mode'
const options = computed(() => tripProfiles(props.segments).map(id => PROFILE_TABS.find(t => t.id === id)!))
const selected = computed({
  get: () => colorBy.value ?? MODE,
  set: (v: string) => { colorBy.value = v === MODE ? null : (v as RouteProfileType) },
})
const label = computed(() => options.value.find(o => o.id === colorBy.value)?.label ?? 'Travel mode')

const stats = computed(() => {
  const profile = colorBy.value
  if (!profile) return []
  return profileStats(props.segments.filter(s => canColorBy(s, profile)).flatMap(s => s.edgeSegments ?? []), profile)
})
const summary = computed(() => (colorBy.value ? profileSummary(stats.value, colorBy.value) : ''))
</script>

<template>
  <div v-if="options.length" class="flex items-start justify-between gap-3 px-3">
    <div class="min-w-0 flex-1">
      <p v-if="summary" class="text-sm font-medium text-foreground">{{ summary }}</p>
      <div v-if="stats.length" class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <div v-for="stat in stats" :key="stat.key" class="flex items-center gap-1.5">
          <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: stat.color }" />
          <span class="text-[11px] leading-none text-muted-foreground">{{ stat.percentage }}% {{ stat.label.toLowerCase() }}</span>
        </div>
      </div>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" size="sm" class="h-7 shrink-0 px-2.5 text-xs">
          {{ label }}
          <ChevronDownIcon class="-mr-0.5 ml-1 size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-44">
        <DropdownMenuRadioGroup v-model="selected">
          <DropdownMenuRadioItem :value="MODE">Travel mode</DropdownMenuRadioItem>
          <DropdownMenuRadioItem v-for="option in options" :key="option.id" :value="option.id">
            {{ option.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
