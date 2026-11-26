<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'
import { usePlaceService } from '@/services/place/place.service'
import { PermissionId } from '@/types/auth.types'
import type { Place } from '@/types/place.types'
import { listingPlaceId, listingProviderName, listingTitle } from '@/lib/place/listing-providers'
import { fetchPlaceListings, type ProviderListing } from '@/services/place/listings.service'
import ListingPicker from './ListingPicker.vue'

const props = defineProps<{ place: Partial<Place> }>()

const { t } = useI18n()
const authService = useAuthService()
const { refreshPlaceDetails } = usePlaceService()

const placeId = computed(() => listingPlaceId(props.place.externalIds))
const canCorrect = computed(() => authService.hasPermission(PermissionId.PLACES_LISTINGS_WRITE))

const listings = shallowRef<ProviderListing[]>([])
const editing = shallowRef<ProviderListing | null>(null)
const pickerOpen = ref(false)

async function load() {
  listings.value = []
  if (!canCorrect.value || !placeId.value) return
  const id = placeId.value
  try {
    const found = await fetchPlaceListings(id)
    if (placeId.value === id) listings.value = found
  } catch {
    listings.value = []
  }
}

watch([placeId, canCorrect], load, { immediate: true })

function edit(listing: ProviderListing) {
  editing.value = listing
  pickerOpen.value = true
}

async function onSaved() {
  await load()
  if (placeId.value) await refreshPlaceDetails(placeId.value)
}
</script>

<template>
  <section
    v-if="listings.length"
    class="rounded-lg border px-3.5 py-2.5"
    data-testid="place-listings"
  >
    <h3 class="text-xs text-muted-foreground mb-1.5">
      {{ t('place.listings.title') }}
    </h3>
    <div
      v-for="listing in listings"
      :key="listing.provider"
      class="flex items-center gap-3 py-1"
    >
      <div v-if="listing.listing" class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">{{ listingTitle(listing.listing) ?? place.name?.value ?? listing.listing.id }}</div>
        <div class="truncate text-xs text-muted-foreground">
          {{ [listingProviderName(listing.provider), listing.listing.address].filter(Boolean).join(' · ') }}
        </div>
      </div>
      <div v-else class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">{{ listingProviderName(listing.provider) }}</div>
        <div class="truncate text-xs text-muted-foreground">
          {{ t(listing.confirmed ? 'place.listings.notListed' : 'place.listings.none') }}
        </div>
      </div>
      <Button variant="ghost" size="sm" @click="edit(listing)">
        {{ t('place.listings.change') }}
      </Button>
    </div>

    <ListingPicker
      v-if="placeId"
      v-model:open="pickerOpen"
      :place-id="placeId"
      :place-name="place.name?.value ?? undefined"
      :listing="editing"
      @saved="onSaved"
    />
  </section>
</template>
