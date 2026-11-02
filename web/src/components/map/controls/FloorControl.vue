<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMapService } from '@/services/map/map.service'
import { useMapStore } from '@/stores/map.store'

const { t } = useI18n()
const mapService = useMapService()
const { indoorFocus } = storeToRefs(useMapStore())
</script>

<template>
  <Transition
    enter-from-class="opacity-0 translate-x-2"
    leave-to-class="opacity-0 translate-x-2"
    enter-active-class="transition duration-200 ease-out"
    leave-active-class="transition duration-150 ease-in"
  >
    <div
      v-if="indoorFocus"
      :key="indoorFocus.venue.id"
      role="radiogroup"
      :aria-label="indoorFocus.venue.name ?? t('settings.mapSettings.controls.floors')"
      class="flex max-h-72 min-w-10 flex-col items-stretch overflow-y-auto rounded-md border bg-background/95 p-1 shadow-sm backdrop-blur scrollbar-hidden"
    >
      <button
        v-for="{ level, name } in indoorFocus.venue.levels"
        :key="level"
        type="button"
        role="radio"
        :aria-checked="level === indoorFocus.level"
        class="h-8 shrink-0 truncate rounded-sm px-1 text-xs font-semibold tabular-nums transition-colors"
        :class="
          level === indoorFocus.level
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        "
        @click="mapService.setIndoorLevel(level)"
      >
        {{ name }}
      </button>
    </div>
  </Transition>
</template>
