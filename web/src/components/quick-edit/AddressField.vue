<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SearchIcon, MapPinIcon, PencilIcon } from 'lucide-vue-next'
import { forwardGeocode, reverseGeocode } from '@/services/geocoding.service'
import { addressToTags, formatAddressLine } from '@/lib/quick-edit/address-tags'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  tags: Record<string, string>
  lat: number
  lng: number
}>()

const emit = defineEmits<{
  set: [key: string, value: string | null]
}>()

const { t } = useI18n()

const PARTS = [
  { key: 'addr:housenumber', labelKey: 'quickEdit.address.housenumber', span: 'col-span-1' },
  { key: 'addr:street', labelKey: 'quickEdit.address.street', span: 'col-span-2' },
  { key: 'addr:city', labelKey: 'quickEdit.address.city', span: 'col-span-2' },
  { key: 'addr:postcode', labelKey: 'quickEdit.address.postcode', span: 'col-span-1' },
]

const query = ref('')
const results = ref<Place[]>([])
const searching = ref(false)
const locating = ref(false)
const manual = ref(false)

const summary = computed(() => {
  const line = [props.tags['addr:housenumber'], props.tags['addr:street']]
    .filter(Boolean)
    .join(' ')
  const rest = [props.tags['addr:city'], props.tags['addr:postcode']]
    .filter(Boolean)
    .join(' ')
  return [line, rest].filter(Boolean).join(', ')
})

let debounce: ReturnType<typeof setTimeout> | undefined
function onQuery(value: string) {
  query.value = value
  clearTimeout(debounce)
  if (value.trim().length < 3) {
    results.value = []
    return
  }
  debounce = setTimeout(async () => {
    searching.value = true
    try {
      const response = await forwardGeocode({
        query: value,
        lat: props.lat,
        lng: props.lng,
        limit: 5,
      })
      // The geocoder returns bare fragments ("155") alongside real addresses;
      // a suggestion with no street to offer isn't worth a row.
      results.value = response.results.filter((place) =>
        Boolean(place.address?.value?.street1 || place.address?.value?.formatted),
      )
    } catch {
      results.value = []
    } finally {
      searching.value = false
    }
  }, 300)
}

onUnmounted(() => clearTimeout(debounce))

function apply(tags: Record<string, string>) {
  if (!Object.keys(tags).length) return
  for (const [key, value] of Object.entries(tags)) emit('set', key, value)
  query.value = ''
  results.value = []
}

function choose(place: Place) {
  apply(addressToTags(place.address?.value))
}

async function usePinLocation() {
  locating.value = true
  try {
    const response = await reverseGeocode({ lat: props.lat, lng: props.lng, limit: 1 })
    apply(addressToTags(response.results[0]?.address?.value))
  } catch {
    // Nothing to fill in; the manual fields are still there.
  } finally {
    locating.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="relative">
      <SearchIcon
        class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        :model-value="query"
        :placeholder="summary || t('quickEdit.address.searchPlaceholder')"
        class="pl-9"
        @update:model-value="onQuery(String($event))"
      />
      <Spinner
        v-if="searching"
        class="absolute right-3 top-1/2 size-4 -translate-y-1/2"
      />
    </div>

    <div v-if="results.length" class="space-y-0.5">
      <button
        v-for="place in results"
        :key="place.id"
        type="button"
        class="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
        @click="choose(place)"
      >
        {{ formatAddressLine(place.address?.value) || place.name?.value }}
      </button>
    </div>

    <div class="flex gap-2">
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs text-muted-foreground"
        :loading="locating"
        @click="usePinLocation"
      >
        <MapPinIcon class="mr-1 size-3" />
        {{ t('quickEdit.address.usePin') }}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs text-muted-foreground"
        @click="manual = !manual"
      >
        <PencilIcon class="mr-1 size-3" />
        {{ t('quickEdit.address.editManually') }}
      </Button>
    </div>

    <div v-if="manual || summary" class="grid grid-cols-3 gap-1.5">
      <Input
        v-for="part in PARTS"
        :key="part.key"
        :model-value="tags[part.key] ?? ''"
        :placeholder="t(part.labelKey)"
        :class="part.span"
        class="h-8 text-xs"
        @update:model-value="emit('set', part.key, String($event) || null)"
      />
    </div>
  </div>
</template>
