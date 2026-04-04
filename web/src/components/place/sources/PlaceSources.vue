<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import PlaceSection from '../details/PlaceSection.vue'
import type { Place } from '@/types/place.types'

defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
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
  <PlaceSection>
    <template #main>
      <div class="space-y-3">
        <div
          v-for="source in place.sources"
          :key="source.id"
        >
          <!-- OSM Source with collapsible tags -->
          <div v-if="source.id === 'osm'">
            <Collapsible v-model:open="showTags">
              <CollapsibleTrigger class="w-full cursor-pointer">
                <div class="flex items-center justify-between group">
                  <div class="flex flex-col items-start flex-1">
                    <span class="text-sm font-medium">{{ source.name }}</span>
                    <span
                      v-if="source.updated"
                      class="text-xs text-muted-foreground text-start"
                    >
                      {{
                        source.updatedBy
                          ? t('place.sources.lastUpdatedBy', { date: formatDate(source.updated), updatedBy: source.updatedBy })
                          : t('place.sources.lastUpdated', { date: formatDate(source.updated) })
                      }}
                    </span>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                      v-if="source.url"
                      @click.stop
                    >
                      <a
                        :href="source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        :title="t('place.sources.viewOn', { name: source.name })"
                      >
                        <ExternalLinkIcon class="size-4" />
                      </a>
                    </Button>
                    <Button 
                      variant="ghost"
                      size="icon-xs"
                    >
                      <ChevronDownIcon
                        class="size-4 text-muted-foreground transition-transform group-hover:text-foreground"
                        :class="{ 'rotate-180': showTags }"
                      />
                    </Button>
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div class="mt-2 bg-muted/30 rounded-md p-3">
                  <div class="space-y-1">
                    <div
                      v-for="[key, value] in Object.entries(place.tags || {})"
                      :key="key"
                      class="flex items-start justify-between gap-3 text-xs font-mono"
                    >
                      <span class="text-muted-foreground min-w-0 flex-shrink-0">
                        {{ key }}
                      </span>
                      <span class="break-all text-right min-w-0 text-foreground">
                        {{ value }}
                      </span>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          
          <!-- Other sources (non-collapsible) -->
          <div v-else>
            <div class="flex items-center justify-between">
              <div class="flex-1 flex flex-col items-start">
                <span class="text-sm font-medium">{{ source.name }}</span>
                <span
                  v-if="source.updated"
                  class="text-xs text-muted-foreground"
                >
                  {{
                    source.updatedBy
                      ? t('place.sources.lastUpdatedBy', { date: formatDate(source.updated), updatedBy: source.updatedBy })
                      : t('place.sources.lastUpdated', { date: formatDate(source.updated) })
                  }}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                asChild
                v-if="source.url"
              >
                <a
                  :href="source.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="t('place.sources.viewOn', { name: source.name })"
                >
                  <ExternalLinkIcon class="size-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </PlaceSection>
</template>
