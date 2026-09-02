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
import { useAppStore } from '@/stores/app.store'
import { FloorNumbering } from '@/types/map.types'

const props = defineProps<{
  data: WidgetResponse<Record<string, string>>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const { t } = useI18n()
const appStore = useAppStore()

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
    if (!isNaN(num) && appStore.floorNumbering === FloorNumbering.ONE_BASED) {
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

interface TagValueRow {
  id: string
  label: string
  fullKey: string
  text: string
  rawValue: string
  href?: string
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

function subtagLabel(sub: TagGroup['subtags'][number]): string {
  const fullKeyLabel = getOsmTagLabel(sub.fullKey)
  if (fullKeyLabel !== formatWord(sub.fullKey)) return tagLabel(sub.fullKey)
  return tagLabel(sub.subKey)
}

function valueRows(group: TagGroup): TagValueRow[] {
  const rows: TagValueRow[] = []

  if (group.rootValue !== undefined) {
    const formatted = formatValue(group.rootKey, group.rootValue)
    rows.push({
      id: group.rootKey,
      label: tagLabel(group.rootKey),
      fullKey: group.rootKey,
      text: formatted.text,
      rawValue: group.rootValue,
      href: formatted.href,
    })
  }

  for (const sub of group.subtags) {
    const formatted = formatValue(sub.fullKey, sub.value)
    rows.push({
      id: sub.fullKey,
      label: subtagLabel(sub),
      fullKey: sub.fullKey,
      text: formatted.text,
      rawValue: sub.value,
      href: formatted.href,
    })
  }

  return rows
}

function valueCopyMessage(label: string): string {
  return t('place.osmTags.copiedMessage', { label })
}
</script>

<template>
  <PlaceSection v-if="hasListTags">
    <template #main>
      <div class="space-y-3">
        <div
          v-for="group in groupedTags"
          :key="group.rootKey"
          class="group relative flex min-w-0 items-start gap-3"
        >
          <component
            :is="getOsmTagIcon(group.rootKey)"
            class="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />

          <div class="flex min-w-0 flex-1 flex-col">
            <div class="min-w-0 pr-7 text-sm leading-tight text-muted-foreground">
              {{ tagLabel(group.rootKey) }}
            </div>

            <div
              :class="[
                'min-w-0',
                group.subtags.length > 0 ? 'mt-1 divide-y divide-border/50' : '',
              ]"
            >
              <div
                v-for="row in valueRows(group)"
                :key="row.id"
                class="flex min-w-0 items-center gap-2"
                :class="group.subtags.length > 0 ? 'min-h-8 py-1' : ''"
              >
                <div
                  v-if="row.fullKey !== group.rootKey"
                  class="w-24 shrink-0 truncate text-xs text-muted-foreground"
                  :title="row.label"
                >
                  {{ row.label }}
                </div>
                <div
                  class="min-w-0 flex-1 break-words leading-snug text-foreground"
                  :class="group.subtags.length > 0 ? 'text-sm' : 'text-[15px]'"
                >
                  <a
                    v-if="row.href"
                    :href="row.href"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="break-all text-primary hover:underline"
                  >
                    {{ row.text }}
                  </a>
                  <span v-else>{{ row.text }}</span>
                </div>

                <CopyButton
                  :text="row.rawValue"
                  :message="valueCopyMessage(row.label)"
                  class="-mr-1 shrink-0 opacity-60 transition-opacity hover:opacity-100"
                />
              </div>
            </div>
          </div>

          <a
            v-if="osmUrlWithCoords"
            :href="osmUrlWithCoords"
            target="_blank"
            rel="noopener noreferrer"
            class="absolute -right-1 -top-1 rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            :title="t('place.osmTags.viewOnOpenStreetMap')"
          >
            <ExternalLinkIcon class="h-4 w-4 text-muted-foreground" />
          </a>
        </div>
      </div>
    </template>
  </PlaceSection>
</template>
