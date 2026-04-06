<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import type { WidgetResponse, WidgetDescriptor, Place } from '@/types/place.types'
import PlaceSection from '@/components/place/details/PlaceSection.vue'
import CopyButton from '@/components/CopyButton.vue'
import { ExternalLinkIcon } from 'lucide-vue-next'
import { formatWord } from '@/lib/string.utils'
import { getOsmTagLabel, osmKeyToI18nKey } from '@/lib/osm-tag-labels'
import { getOsmTagIcon } from '@/lib/osm-tag-icons'
import { usePreferencesStore } from '@/stores/preferences.store'
import { FloorNumbering } from '@/types/map.types'

const props = defineProps<{
  data: WidgetResponse<Record<string, string>>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const { t } = useI18n()
const preferencesStore = usePreferencesStore()

/** Translate an OSM tag key label, falling back to the English TAG_LABELS dict. */
function tagLabel(key: string): string {
  const i18nKey = `place.osmTags.labels.${osmKeyToI18nKey(key)}`
  return t(i18nKey, getOsmTagLabel(key))
}

// ── OSM link ─────────────────────────────────────────────────────────────────

const osmUrl = computed(() => {
  const source = props.place.sources?.find(s => s.id === 'osm')
  return source?.url || ''
})

const osmUrlWithCoords = computed(() => {
  const center = props.place.geometry?.value?.center
  if (osmUrl.value && center) {
    return `${osmUrl.value}#map=19/${center.lat}/${center.lng}`
  }
  return osmUrl.value
})

// ── Value formatting ──────────────────────────────────────────────────────────

/** OSM tag keys whose values represent dates */
const DATE_KEYS = new Set([
  'start_date', 'end_date', 'opening_date', 'construction:date',
  'demolished:date', 'check_date', 'survey:date',
])

/**
 * Parse an OSM date value which may be:
 *   YYYY           → year only
 *   YYYY-MM        → month + year
 *   YYYY-MM-DD     → full date
 * Returns a formatted human-friendly string, or null if unparseable.
 */
function formatOsmDate(value: string): string | null {
  const yearOnly = /^\d{4}$/.exec(value)
  if (yearOnly) return value // e.g. "1985"

  const yearMonth = /^(\d{4})-(\d{2})$/.exec(value)
  if (yearMonth) {
    const d = dayjs(`${value}-01`)
    return d.isValid() ? d.format('MMMM YYYY') : null // "June 1985"
  }

  const fullDate = /^\d{4}-\d{2}-\d{2}$/.exec(value)
  if (fullDate) {
    const d = dayjs(value)
    return d.isValid() ? d.format('MMMM D, YYYY') : null // "June 15, 1985"
  }

  return null
}

function formatValue(key: string, value: string): { text: string; href?: string } {
  // URL
  try {
    const u = new URL(value)
    if (u.protocol === 'http:' || u.protocol === 'https:') return { text: value, href: value }
  } catch { /* not a URL */ }

  // Floor/level display — adjust for one-based numbering
  if (key === 'level') {
    const num = parseInt(value, 10)
    if (!isNaN(num) && preferencesStore.floorNumbering === FloorNumbering.ONE_BASED) {
      return { text: String(num + 1) }
    }
  }

  // Date fields
  if (DATE_KEYS.has(key)) {
    const formatted = formatOsmDate(value)
    if (formatted) return { text: formatted }
  }

  // Semicolon-separated lists (e.g. cuisine=italian;pizza)
  if (value.includes(';')) {
    return { text: value.split(';').map(v => formatWord(v.trim())).filter(Boolean).join(', ') }
  }

  // Speed limit — append units if raw number
  if (key === 'maxspeed' && /^\d+$/.test(value)) return { text: t('place.osmTags.speedLimit', { value }) }

  // Canonical yes/no
  if (value === 'yes') return { text: t('general.yes') }
  if (value === 'no') return { text: t('general.no') }
  if (value === 'only') return { text: t('place.osmTags.values.only') }
  if (value === 'limited') return { text: t('place.osmTags.values.limited') }
  if (value === 'designated') return { text: t('place.osmTags.values.designated') }
  if (value === 'permissive') return { text: t('place.osmTags.values.permissive') }

  return { text: formatWord(value) }
}

// ── Sort order ────────────────────────────────────────────────────────────────

const KEY_PRIORITY: string[] = [
  'capacity', 'seats', 'rooms', 'beds',
  'access', 'fee', 'charge', 'toll', 'maxstay',
  'wheelchair',
  'indoor', 'covered', 'lit', 'surface', 'level', 'building:levels',
  'bicycle_parking', 'parking', 'cargo_bike',
  'drinking_water', 'bottle', 'seasonal',
  'internet_access',
  'toilets', 'shower', 'changing_table',
  'smoking',
  'operator', 'brand', 'network', 'ref',
  'delivery', 'takeaway', 'outdoor_seating', 'drive_through',
  'cuisine',
]

// ── Tag grouping ──────────────────────────────────────────────────────────────

interface TagGroup {
  rootKey: string
  rootValue?: string
  subtags: Array<{ subKey: string; fullKey: string; value: string }>
}

const tags = computed(() => props.data.data.value as Record<string, string>)

const groupedTags = computed((): TagGroup[] => {
  const groups = new Map<string, TagGroup>()

  for (const [key, value] of Object.entries(tags.value)) {
    const colonIdx = key.indexOf(':')
    if (colonIdx === -1) {
      // Root-level key (no colon)
      const g = groups.get(key) || { rootKey: key, subtags: [] }
      g.rootValue = value
      groups.set(key, g)
    } else {
      // Sub-key: group under the root prefix
      const rootKey = key.substring(0, colonIdx)
      const subKey = key.substring(colonIdx + 1)
      const g = groups.get(rootKey) || { rootKey, subtags: [] }
      g.subtags.push({ subKey, fullKey: key, value })
      groups.set(rootKey, g)
    }
  }

  // Sort by priority list, then alphabetically
  return [...groups.values()].sort((a, b) => {
    const ai = KEY_PRIORITY.indexOf(a.rootKey)
    const bi = KEY_PRIORITY.indexOf(b.rootKey)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.rootKey.localeCompare(b.rootKey)
  })
})

const hasListTags = computed(() => groupedTags.value.length > 0)

/** Build a plain-text copy string for a tag group */
function copyText(group: TagGroup): string {
  const lines: string[] = []
  if (group.rootValue !== undefined) {
    lines.push(formatValue(group.rootKey, group.rootValue).text)
  }
  for (const sub of group.subtags) {
    lines.push(`${tagLabel(sub.subKey)}: ${formatValue(sub.fullKey, sub.value).text}`)
  }
  return lines.join('\n')
}

function tagCopyMessage(rootKey: string): string {
  return t('place.osmTags.copiedMessage', { label: tagLabel(rootKey) })
}
</script>

<template>
  <PlaceSection v-if="hasListTags">
    <template #main>
      <div class="space-y-3">
        <div
          v-for="group in groupedTags"
          :key="group.rootKey"
          class="flex gap-3 items-center min-w-0 group"
        >
          <!-- Icon — vertically centered relative to the full row -->
          <component
            :is="getOsmTagIcon(group.rootKey)"
            class="size-4 shrink-0 text-muted-foreground"
          />

          <!-- Label + value(s) -->
          <div class="flex flex-col flex-1 min-w-0">
            <!-- Row label -->
            <div class="text-sm text-muted-foreground leading-tight">
              {{ tagLabel(group.rootKey) }}
            </div>

            <!-- Root value (if present) -->
            <div v-if="group.rootValue !== undefined" class="leading-snug break-words">
              <a
                v-if="formatValue(group.rootKey, group.rootValue).href"
                :href="formatValue(group.rootKey, group.rootValue).href"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline break-all"
              >
                {{ formatValue(group.rootKey, group.rootValue).text }}
              </a>
              <span v-else>{{ formatValue(group.rootKey, group.rootValue).text }}</span>
            </div>

            <!-- Sub-tags (e.g. toilets:access, internet_access:fee) -->
            <div
              v-for="sub in group.subtags"
              :key="sub.fullKey"
              class="text-sm text-muted-foreground leading-snug"
            >
              <span class="font-medium text-foreground/70">{{ tagLabel(sub.subKey) }}:</span>
              {{ ' ' }}
              <a
                v-if="formatValue(sub.fullKey, sub.value).href"
                :href="formatValue(sub.fullKey, sub.value).href"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline break-all"
              >
                {{ formatValue(sub.fullKey, sub.value).text }}
              </a>
              <span v-else>{{ formatValue(sub.fullKey, sub.value).text }}</span>
            </div>
          </div>

          <!-- Hover actions: copy + OSM link -->
          <div class="flex opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <CopyButton
              :text="copyText(group)"
              :message="tagCopyMessage(group.rootKey)"
            />
            <a
              v-if="osmUrlWithCoords"
              :href="osmUrlWithCoords"
              target="_blank"
              rel="noopener noreferrer"
              class="p-1 hover:bg-muted rounded"
              :title="t('place.osmTags.viewOnOpenStreetMap')"
            >
              <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
            </a>
          </div>
        </div>
      </div>
    </template>
  </PlaceSection>
</template>
