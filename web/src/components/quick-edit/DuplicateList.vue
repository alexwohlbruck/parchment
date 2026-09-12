<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon, PencilIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { DuplicateCandidate } from '@/types/quick-edit.types'

defineProps<{
  candidates: DuplicateCandidate[]
}>()

const emit = defineEmits<{
  edit: [candidate: DuplicateCandidate]
}>()

const { t } = useI18n()
</script>

<template>
  <div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
      <TriangleAlertIcon class="size-4 text-amber-500" />
      {{ t('quickEdit.duplicatesTitle', candidates.length) }}
    </div>
    <p class="mb-2 text-xs text-muted-foreground">
      {{ t('quickEdit.duplicatesHint') }}
    </p>
    <div class="space-y-1">
      <div
        v-for="candidate in candidates"
        :key="candidate.osm"
        class="flex items-center gap-2 text-sm"
      >
        <span class="min-w-0 flex-1 truncate">
          {{ candidate.name || candidate.placeType || candidate.osm }}
          <span class="text-xs text-muted-foreground">
            · {{ candidate.distanceM }} m
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 shrink-0 px-2 text-xs"
          @click="emit('edit', candidate)"
        >
          <PencilIcon class="mr-1 size-3" />
          {{ t('quickEdit.editThisInstead') }}
        </Button>
      </div>
    </div>
  </div>
</template>
