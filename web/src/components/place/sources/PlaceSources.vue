<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import type { UnifiedPlace } from '@/types/unified-place.types'

defineProps<{
  place: UnifiedPlace
}>()

const showTags = ref(false)

function formatDate(dateString: string) {
  try {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat(navigator.language, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(date)
  } catch (e) {
    console.error('Error formatting date:', e)
    return dateString
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <h2 class="text-sm font-medium">Sources</h2>
    <!-- Source Info -->
    <div
      v-for="source in place.sources"
      :key="source.id"
      class="border border-border rounded-lg overflow-hidden"
    >
      <div class="pl-3 pr-1 py-1 flex flex-col">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <button
                v-if="source.id === 'osm'"
                @click="showTags = !showTags"
                class="flex-1 flex items-center justify-between"
              >
                <div class="div flex flex-col items-start">
                  <span class="text-sm">{{ source.name }}</span>
                  <span
                    v-if="source.updated"
                    class="text-xs text-muted-foreground text-start"
                  >
                    Last updated
                    {{ formatDate(source.updated) }}
                    {{ source.updatedBy ? `by ${source.updatedBy}` : '' }}
                  </span>
                </div>
                <ChevronDownIcon
                  class="size-4 text-muted-foreground transition-transform"
                  :class="{ 'rotate-180': showTags }"
                />
              </button>
              <div v-else class="flex-1 flex flex-col items-start">
                <span class="text-sm">{{ source.name }}</span>
                <span
                  v-if="source.updated"
                  class="text-xs text-muted-foreground"
                >
                  Last updated
                  {{ formatDate(source.updated) }}
                  {{ source.updatedBy ? `by ${source.updatedBy}` : '' }}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="ml-2"
                asChild
                v-if="source.url"
              >
                <a
                  :href="source.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="`View on ${source.name}`"
                >
                  <ExternalLinkIcon class="size-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="source.id === 'osm' && showTags">
        <Table>
          <TableBody>
            <TableRow
              v-for="[key, value] in Object.entries(place.amenities || {})"
              :key="key"
            >
              <TableCell class="font-medium text-muted-foreground">
                {{ key }}
              </TableCell>
              <TableCell class="break-all">
                {{ value }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>
</template>
