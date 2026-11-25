<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { refDebounced } from '@vueuse/core'
import { CheckIcon } from 'lucide-vue-next'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/lib/toast'
import { useUnits } from '@/composables/useUnits'
import { listingProviderName } from '@/lib/place/listing-providers'
import {
  correctListing,
  fetchListingCandidates,
  type ListingSummary,
  type ProviderListing,
} from '@/services/place/listings.service'

const props = defineProps<{
  placeId: string
  placeName?: string
  listing: ProviderListing | null
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const { formatDistance } = useUnits()

const query = ref('')
const debouncedQuery = refDebounced(query, 300)
const candidates = shallowRef<ListingSummary[]>([])
const loading = ref(false)
const saving = ref<string | null>(null)

const provider = computed(() => props.listing?.provider ?? '')
const providerName = computed(() => listingProviderName(provider.value))
const currentId = computed(() => props.listing?.listing?.id ?? null)
const cleared = computed(() => !!props.listing?.confirmed && !currentId.value)

/** The current listing stays pickable even when the search no longer returns it. */
const options = computed(() => {
  const current = props.listing?.listing
  if (!current || candidates.value.some(c => c.id === current.id)) return candidates.value
  return [current, ...candidates.value]
})

let request = 0
async function search() {
  if (!open.value || !provider.value || !props.listing?.searchable) return
  const mine = ++request
  loading.value = true
  try {
    const found = await fetchListingCandidates(props.placeId, provider.value, debouncedQuery.value)
    if (mine === request) candidates.value = found
  } catch {
    if (mine === request) candidates.value = []
  } finally {
    if (mine === request) loading.value = false
  }
}

watch(open, isOpen => {
  if (!isOpen) return
  query.value = props.placeName ?? ''
  candidates.value = []
  search()
})
watch(debouncedQuery, search)

async function choose(providerPlaceId: string | null) {
  saving.value = providerPlaceId ?? 'none'
  try {
    await correctListing(props.placeId, provider.value, providerPlaceId)
    toast.success(t('place.listings.saved'))
    open.value = false
    emit('saved')
  } catch (cause) {
    toast.error(t('place.listings.failed'), { cause })
  } finally {
    saving.value = null
  }
}

function detail(candidate: ListingSummary) {
  return [candidate.address, candidate.distance != null ? formatDistance(candidate.distance) : null]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t('place.listings.pickerTitle', { provider: providerName })"
    :description="t('place.listings.pickerDescription')"
  >
    <template #content>
      <div class="flex flex-col gap-3">
        <Input
          v-if="listing?.searchable"
          v-model="query"
          :placeholder="t('place.listings.search', { provider: providerName })"
          data-testid="listing-search"
        />

        <div class="flex flex-col -mx-2">
          <div v-if="loading && !options.length" class="flex justify-center py-6">
            <Spinner />
          </div>
          <p
            v-else-if="!options.length"
            class="px-2 py-4 text-sm text-muted-foreground"
          >
            {{ t('place.listings.noCandidates') }}
          </p>

          <button
            v-for="candidate in options"
            :key="candidate.id"
            type="button"
            class="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-60"
            :disabled="!!saving"
            data-testid="listing-candidate"
            @click="choose(candidate.id)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">
                {{ candidate.name ?? candidate.id }}
              </span>
              <span v-if="detail(candidate)" class="block truncate text-xs text-muted-foreground">
                {{ detail(candidate) }}
              </span>
            </span>
            <Spinner v-if="saving === candidate.id" class="size-4" />
            <CheckIcon v-else-if="candidate.id === currentId" class="size-4 text-primary" />
          </button>

          <button
            type="button"
            class="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-60"
            :disabled="!!saving"
            data-testid="listing-none"
            @click="choose(null)"
          >
            <span class="flex-1 text-sm font-medium">
              {{ t('place.listings.noneOption', { provider: providerName }) }}
            </span>
            <Spinner v-if="saving === 'none'" class="size-4" />
            <CheckIcon v-else-if="cleared" class="size-4 text-primary" />
          </button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
