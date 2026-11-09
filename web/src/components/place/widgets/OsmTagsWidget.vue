<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import type { WidgetResponse, WidgetDescriptor, Place } from '@/types/place.types'
import PlaceSection from '@/components/place/details/PlaceSection.vue'
import { formatWord } from '@/lib/string'
import { getOsmTagLabel, osmKeyToI18nKey } from '@/lib/place/osm-tag-labels'
import { useAppStore } from '@/stores/app.store'
import { useClipboard } from '@/composables/useClipboard'
import { useUnits } from '@/composables/useUnits'
import { FloorNumbering } from '@/types/map.types'

const props = defineProps<{
  data: WidgetResponse<Record<string, string>>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const { t } = useI18n()
const appStore = useAppStore()
const { copy } = useClipboard()
const { formatElevation } = useUnits()

/** Translate an OSM tag key label, falling back to the English TAG_LABELS dict. */
function tagLabel(key: string): string {
  const i18nKey = `place.osmTags.labels.${osmKeyToI18nKey(key)}`
  return t(i18nKey, getOsmTagLabel(key))
}

// ── Value formatting ──────────────────────────────────────────────────────────

/** OSM tag keys whose values represent dates */
const DATE_KEYS = new Set([
  'start_date', 'end_date', 'opening_date', 'construction:date',
  'demolished:date', 'check_date', 'survey:date',
])

/** OSM tag keys whose bare numeric values are metres */
const LENGTH_KEYS = new Set([
  'height', 'min_height', 'ele', 'width', 'length', 'depth', 'diameter',
  'maxheight', 'maxwidth', 'maxlength',
])

const METRES_RE = /^(-?\d+(?:\.\d+)?)\s*m?$/

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

  if (LENGTH_KEYS.has(key)) {
    const metres = METRES_RE.exec(value.trim())
    if (metres) return { text: formatElevation(Number(metres[1])) }
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
  text: string
  rawValue: string
  href?: string
  nested: boolean
}

interface TagGroupDisplay {
  id: string
  caption?: string
  rows: TagValueRow[]
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

function valueRow(key: string, label: string, value: string, nested = false): TagValueRow {
  return { id: key, label, rawValue: value, nested, ...formatValue(key, value) }
}

function knownLabel(key: string): string | null {
  return getOsmTagLabel(key) !== formatWord(key) ? tagLabel(key) : null
}

/**
 * A group with a value of its own, or several sub-tags, nests its sub-tags
 * beneath it; a lone sub-tag reads better as one prefixed row.
 */
function groupDisplay(group: TagGroup): TagGroupDisplay {
  const rootLabel = tagLabel(group.rootKey)
  const [onlySub] = group.subtags

  if (group.rootValue === undefined && group.subtags.length === 1) {
    const label = knownLabel(onlySub.fullKey) ?? `${rootLabel} · ${tagLabel(onlySub.subKey)}`
    return { id: group.rootKey, rows: [valueRow(onlySub.fullKey, label, onlySub.value)] }
  }

  const nested = group.subtags.map(sub =>
    valueRow(sub.fullKey, knownLabel(sub.fullKey) ?? tagLabel(sub.subKey), sub.value, true),
  )
  if (group.rootValue === undefined) {
    return { id: group.rootKey, caption: rootLabel, rows: nested }
  }
  return {
    id: group.rootKey,
    rows: [valueRow(group.rootKey, rootLabel, group.rootValue), ...nested],
  }
}

const displayGroups = computed(() => groupedTags.value.map(groupDisplay))

function valueCopyMessage(label: string): string {
  return t('place.osmTags.copiedMessage', { label })
}
</script>

<template>
  <PlaceSection v-if="displayGroups.length > 0">
    <template #main>
      <div class="-my-1.5 divide-y divide-border/50 text-sm">
        <dl v-for="group in displayGroups" :key="group.id" class="py-2">
          <div v-if="group.caption" class="pb-1 text-muted-foreground">
            {{ group.caption }}
          </div>
          <div
            v-for="row in group.rows"
            :key="row.id"
            class="flex min-w-0 items-baseline gap-4"
            :class="{ 'pt-1': row.nested }"
          >
            <dt
              class="w-2/5 shrink-0 text-muted-foreground"
              :class="{ 'pl-3 text-xs': row.nested }"
            >
              {{ row.label }}
            </dt>
            <dd class="min-w-0 flex-1 break-words">
              <a
                v-if="row.href"
                :href="row.href"
                target="_blank"
                rel="noopener noreferrer"
                class="break-all text-primary hover:underline"
              >
                {{ row.text }}
              </a>
              <button
                v-else
                type="button"
                class="cursor-pointer text-left"
                @click="copy(row.rawValue, valueCopyMessage(row.label))"
              >
                {{ row.text }}
              </button>
            </dd>
          </div>
        </dl>
      </div>
    </template>
  </PlaceSection>
</template>
