<script setup lang="ts">
import {
  PhoneIcon,
  GlobeIcon,
  MapPinIcon,
  UtensilsCrossedIcon,
  WifiIcon,
  TreesIcon,
  AccessibilityIcon,
  CigaretteIcon,
  ToiletIcon,
  MailIcon,
  LinkIcon,
  MapIcon,
  PlusIcon,
  ClockIcon,
} from 'lucide-vue-next'
import DetailItem from './DetailItem.vue'
import PlaceHours from './PlaceHours.vue'
import type { Place, DisplayChip } from '@/types/place.types'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getWifiStatus, parseCuisines } from '@/lib/place.utils'
import { resolveIconByName } from '@/lib/osm-tag-icons'
import { SOURCE } from '@/lib/constants'
import { encode } from 'pluscodes'
import PlaceSection from './PlaceSection.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()

const cuisines = computed(() => {
  if (!props.place) return null
  const amenity = props.place.amenities?.cuisine?.value as string
  return amenity ? parseCuisines(amenity) : null
})

/** Diet chips from server-computed displayChips (section === 'diet') */
const dietChips = computed((): DisplayChip[] =>
  (props.place?.displayChips ?? []).filter(c => c.section === 'diet')
)

const hasCuisineSection = computed(() =>
  (cuisines.value && cuisines.value.length > 0) || dietChips.value.length > 0
)

const osmUrl = computed(() => {
  if (!props.place) return ''
  const osmSource = props.place.sources?.find(s => s.id === SOURCE.OSM)
  return osmSource?.url || ''
})

const coordinates = computed(() => {
  if (!props.place?.geometry) return null
  return props.place.geometry.value.center
})

const phoneValue = computed(() => props.place?.contactInfo?.phone?.value)
const emailValue = computed(() => props.place?.contactInfo?.email?.value)

/**
 * All website URLs for the place: the typed websites[] array is preferred
 * (populated by integrations with primary + sub-key URLs). Falls back to the
 * single contactInfo.website field for backward compatibility.
 */
const websiteUrls = computed((): string[] => {
  const all = props.place?.contactInfo?.websites?.value
  if (all?.length) return all
  const single = props.place?.contactInfo?.website?.value
  return single ? [single] : []
})

/** Keep a single value accessor for old callers */
const websiteValue = computed(() => websiteUrls.value[0] ?? null)

const wifiStatus = computed(() => {
  if (!props.place) return null
  const wifiAmenity = props.place.amenities?.['internet_access']
    ?.value as string
  if (!wifiAmenity) return null

  const wifiTags = {
    internet_access: wifiAmenity,
    'internet_access:ssid': props.place.amenities?.['internet_access:ssid']
      ?.value as string,
    'internet_access:fee': props.place.amenities?.['internet_access:fee']
      ?.value as string,
    'internet_access:password': props.place.amenities?.[
      'internet_access:password'
    ]?.value as string,
  }

  return getWifiStatus(wifiTags)
})

const outdoorSeating = computed(() => {
  if (!props.place) return false
  const seating = props.place.amenities?.['outdoor_seating']?.value
  return seating === 'yes' || seating === true
})

const wheelchairAccess = computed(
  () => props.place?.amenities?.wheelchair?.value || null,
)
const smokingStatus = computed(
  () => props.place?.amenities?.smoking?.value || null,
)
const restroomAccess = computed(
  () => props.place?.amenities?.toilets?.value || null,
)
const wheelchairRestroomAccess = computed(
  () => props.place?.amenities?.['toilets:wheelchair']?.value || null,
)

function formatCoordinates(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

const plusCode = computed(() => {
  if (!coordinates.value) return null
  return encode(
    {
      latitude: coordinates.value.lat,
      longitude: coordinates.value.lng,
    },
    10,
  )
})

const isAddressExpanded = ref(false)
const isHoursExpanded = ref(false)

const DAYS = computed(() => [0, 1, 2, 3, 4, 5, 6].map(i => t(`place.hours.days.${i}`)))

function formatTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour = hours % 12 || 12
  return `${hour}:${minutes.toString().padStart(2, '0')} ${period}`
}

function formatOpeningHours(hours: any) {
  if (!hours || !hours.rawText) return ''

  if (hours.isPermanentlyClosed) return t('place.hours.permanentlyClosed')
  if (hours.isTemporarilyClosed) {
    return hours.nextOpenDate
      ? t('place.hours.temporarilyClosedUntil', { date: new Date(hours.nextOpenDate).toLocaleDateString() })
      : t('place.hours.temporarilyClosed')
  }
  if (hours.isOpen24_7) return t('place.hours.open247')

  return hours.rawText.split(';').join('\n')
}

function getOpeningStatus(hours: any) {
  if (!hours) {
    return { status: '', color: '' }
  }

  if (hours.isPermanentlyClosed) {
    return { status: t('place.hours.permanentlyClosed'), color: 'text-red-500' }
  }

  if (hours.isTemporarilyClosed) {
    return { status: t('place.hours.temporarilyClosed'), color: 'text-orange-500' }
  }

  if (hours.isOpen24_7) {
    return { status: t('place.hours.open247'), color: 'text-green-500' }
  }

  if (hours.regularHours.length === 0) {
    return { status: '', color: '' }
  }

  const now = new Date()
  const currentDay = now.getDay()
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`

  const todayHours = hours.regularHours.find((h: any) => h.day === currentDay)
  if (!todayHours) {
    return { status: t('place.hours.closedToday'), color: 'text-red-500' }
  }

  if (currentTime >= todayHours.open && currentTime <= todayHours.close) {
    return {
      status: t('place.hours.openUntil', { time: formatTime(todayHours.close) }),
      color: 'text-green-500',
    }
  } else if (currentTime < todayHours.open) {
    return {
      status: t('place.hours.opensAt', { time: formatTime(todayHours.open) }),
      color: 'text-orange-500',
    }
  } else {
    // Find next day's opening time
    let nextDay = (currentDay + 1) % 7
    let daysChecked = 0
    while (daysChecked < 7) {
      const nextDayHours = hours.regularHours.find((h: any) => h.day === nextDay)
      if (nextDayHours) {
        return {
          status: t('place.hours.opensDay', { day: DAYS.value[nextDay], time: formatTime(nextDayHours.open) }),
          color: 'text-orange-500',
        }
      }
      nextDay = (nextDay + 1) % 7
      daysChecked++
    }
    return { status: t('place.hours.closed'), color: 'text-red-500' }
  }
}

function getAddressDisplay(address: any) {
  if (!address) return ''
  
  // If we have a formatted address (from Google, etc), use it directly
  if (address.formatted && !address.street1) {
    return address.formatted
  }
  
  // Otherwise use structured address
  return address.street1 || ''
}

function getAddressSecondary(address: any) {
  if (!address) return ''
  
  // If we have a formatted address (from Google, etc), don't show secondary
  if (address.formatted && !address.street1) {
    return ''
  }
  
  // Otherwise build from structured components
  if (address.locality) {
    return `${address.locality}${
      address.region ? `, ${address.region}` : ''
    } ${address.postalCode || ''}`.trim()
  }
  
  return ''
}

function getFullAddress(address: any) {
  if (!address) return ''
  
  // If we have formatted, use it
  if (address.formatted) {
    return address.formatted
  }
  
  // Otherwise build from components
  const parts = [
    address.street1,
    address.locality,
    address.region,
    address.postalCode
  ].filter(Boolean)
  
  return parts.join(', ')
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Primary Information Card -->
    <PlaceSection v-if="place.address || phoneValue || websiteValue || emailValue || place.openingHours">
      <template #main>
        <div class="space-y-4">
          <!-- Address Section -->
          <div v-if="place.address">
            <Collapsible v-if="coordinates || plusCode" v-model:open="isAddressExpanded">
              <CollapsibleTrigger class="w-full cursor-pointer">
                <div class="flex items-center justify-between group">
                  <div class="flex gap-3 items-center group min-w-0 flex-1">
                    <component
                      :is="MapPinIcon"
                      class="size-4 shrink-0 text-muted-foreground"
                    />
                    <div class="flex flex-col flex-1 min-w-0">
                      <div class="text-left">
                        <div class="truncate">
                          {{ getAddressDisplay(place.address.value) }}
                        </div>
                      </div>
                      <div
                        v-if="getAddressSecondary(place.address.value)"
                        class="text-sm text-muted-foreground truncate text-left"
                      >
                        {{ getAddressSecondary(place.address.value) }}
                      </div>
                    </div>
                    <div class="flex opacity-0 group-hover:opacity-100 transition-opacity shrink-0" @click.stop>
                      <CopyButton
                        :text="place.address.value.formatted || getFullAddress(place.address.value)"
                        :message="t('place.details.addressCopied')"
                      />
                      <a
                        v-if="osmUrl"
                        :href="coordinates ? `${osmUrl}#map=19/${coordinates.lat}/${coordinates.lng}` : osmUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="p-1 hover:bg-muted rounded"
                        :title="t('place.details.viewOnOpenStreetMap')"
                      >
                        <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
                      </a>
                    </div>
                  </div>
                  <Button 
                    variant="ghost"
                    size="icon-xs"
                    class="ml-2 shrink-0"
                  >
                    <ChevronDownIcon 
                      class="h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground"
                      :class="{ 'rotate-180': isAddressExpanded }"
                    />
                  </Button>
                </div>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <div class="mt-3 bg-muted/30 rounded-md p-3 space-y-3">
                  <!-- Coordinates -->
                  <DetailItem
                    v-if="coordinates"
                    :icon="GlobeIcon"
                    :value="formatCoordinates(coordinates.lat, coordinates.lng)"
                    :copyValue="formatCoordinates(coordinates.lat, coordinates.lng)"
                    :osmUrl="osmUrl"
                    :coordinates="coordinates"
                    :label="t('place.details.coordinates')"
                  />

                  <!-- Plus Code -->
                  <DetailItem
                    v-if="plusCode"
                    :icon="PlusIcon"
                    :value="plusCode"
                    :copyValue="plusCode"
                    :osmUrl="osmUrl"
                    :coordinates="coordinates"
                    :label="t('place.details.plusCode')"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
            
            <!-- Non-collapsible address -->
            <DetailItem
              v-else
              :icon="MapPinIcon"
              :value="getAddressDisplay(place.address.value)"
              :description="getAddressSecondary(place.address.value)"
              :copyValue="place.address.value.formatted || getFullAddress(place.address.value)"
              :osmUrl="osmUrl"
              :coordinates="coordinates"
              :label="t('place.details.address')"
            />
          </div>
          
          <!-- Hours -->
          <div v-if="place.openingHours">
            <Collapsible v-if="place.openingHours.value.regularHours.length > 0" v-model:open="isHoursExpanded">
              <CollapsibleTrigger class="w-full cursor-pointer">
                <div class="flex items-center justify-between group">
                  <div class="flex gap-3 items-center group min-w-0 flex-1">
                    <component
                      :is="ClockIcon"
                      class="size-4 shrink-0 text-muted-foreground"
                    />
                    <div class="flex flex-col flex-1 min-w-0">
                      <div class="text-left">
                        <span :class="getOpeningStatus(place.openingHours.value).color">
                          {{ getOpeningStatus(place.openingHours.value).status }}
                        </span>
                      </div>
                    </div>
                    <div class="flex opacity-0 group-hover:opacity-100 transition-opacity shrink-0" @click.stop>
                      <CopyButton
                        :text="formatOpeningHours(place.openingHours.value)"
                        :message="t('place.details.hoursCopied')"
                      />
                      <a
                        v-if="osmUrl"
                        :href="osmUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="p-1 hover:bg-muted rounded"
                        :title="t('place.details.viewOnOpenStreetMap')"
                      >
                        <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
                      </a>
                    </div>
                  </div>
                  <Button 
                    variant="ghost"
                    size="icon-xs"
                    class="ml-2 shrink-0"
                  >
                    <ChevronDownIcon 
                      class="h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground"
                      :class="{ 'rotate-180': isHoursExpanded }"
                    />
                  </Button>
                </div>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <div class="mt-3 bg-muted/30 rounded-md p-3">
                  <div class="text-sm text-muted-foreground space-y-1">
                    <div
                      v-for="day in DAYS"
                      :key="day"
                      class="flex justify-between"
                      :class="{ 'font-medium text-foreground': DAYS.indexOf(day) === new Date().getDay() }"
                    >
                      <span>{{ day }}</span>
                      <span>
                        <template
                          v-if="place.openingHours.value.regularHours.find(h => h.day === DAYS.indexOf(day))"
                        >
                          {{
                            formatTime(
                              place.openingHours.value.regularHours.find(h => h.day === DAYS.indexOf(day))!
                                .open,
                            )
                          }}
                          -
                          {{
                            formatTime(
                              place.openingHours.value.regularHours.find(h => h.day === DAYS.indexOf(day))!
                                .close,
                            )
                          }}
                        </template>
                        <template v-else>{{ t('place.hours.closed') }}</template>
                      </span>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            
            <!-- Non-collapsible hours (no regular hours) -->
            <DetailItem
              v-else
              :icon="ClockIcon"
              :osmUrl="osmUrl"
              :copyValue="formatOpeningHours(place.openingHours.value)"
            >
              <div class="flex flex-col">
                <span :class="getOpeningStatus(place.openingHours.value).color">
                  {{ getOpeningStatus(place.openingHours.value).status }}
                </span>
              </div>
            </DetailItem>
          </div>

          <!-- Phone -->
          <DetailItem
            v-if="phoneValue"
            :icon="PhoneIcon"
            :value="phoneValue"
            :copyValue="phoneValue"
            :osmUrl="osmUrl"
            :href="`tel:${phoneValue}`"
            :label="t('place.details.phoneNumber')"
          />

          <!-- Websites (all URLs: primary + sub-key entries like website:menu) -->
          <DetailItem
            v-for="url in websiteUrls"
            :key="url"
            :icon="LinkIcon"
            :value="url"
            :osmUrl="osmUrl"
            :copyValue="url"
            :href="url"
            target="_blank"
            :label="t('place.details.website')"
          />

          <!-- Email -->
          <DetailItem
            v-if="emailValue"
            :icon="MailIcon"
            :value="emailValue"
            :copyValue="emailValue"
            :osmUrl="osmUrl"
            :href="`mailto:${emailValue}`"
            :label="t('place.details.emailAddress')"
          />
        </div>
      </template>
    </PlaceSection>

    <!-- Food & Cuisine Card -->
    <PlaceSection v-if="hasCuisineSection">
      <template #main>
        <div class="space-y-2">
          <!-- Cuisine chips -->
          <div v-if="cuisines && cuisines.length > 0" class="flex gap-3 items-center">
            <UtensilsCrossedIcon class="size-4 text-muted-foreground shrink-0" />
            <div class="flex flex-wrap gap-1">
              <span
                v-for="cuisine in cuisines"
                :key="cuisine"
                class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary transition-colors"
              >
                {{ cuisine }}
              </span>
            </div>
          </div>

          <!-- Diet chips (server-computed) -->
          <div v-if="dietChips.length > 0" class="flex flex-wrap gap-1.5" :class="{ 'ml-7': cuisines && cuisines.length > 0 }">
            <span
              v-for="chip in dietChips"
              :key="`${chip.key}_${chip.value}`"
              class="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
            >
              <component :is="resolveIconByName(chip.icon)" class="size-3" />
              <span>{{ chip.label }}</span>
            </span>
          </div>
        </div>
      </template>
    </PlaceSection>

    <!-- Amenities Card -->
    <PlaceSection v-if="wifiStatus || outdoorSeating || wheelchairAccess || smokingStatus || restroomAccess || wheelchairRestroomAccess">
      <template #main>
        <!-- WiFi -->
        <DetailItem
          v-if="wifiStatus"
          :icon="WifiIcon"
          :value="wifiStatus.label"
          :copyValue="wifiStatus.password"
          :osmUrl="osmUrl"
          :label="t('place.details.wifiPassword')"
        >
          <template v-if="wifiStatus.ssid">
            <span class="text-muted-foreground text-sm">
              {{ t('place.details.wifiNetwork', { ssid: wifiStatus.ssid }) }}
            </span>
          </template>
        </DetailItem>

        <!-- Outdoor Seating -->
        <DetailItem
          v-if="outdoorSeating"
          :icon="TreesIcon"
          :value="t('place.details.outdoorSeating')"
        />

        <!-- Wheelchair Access -->
        <DetailItem
          v-if="wheelchairAccess"
          :icon="AccessibilityIcon"
          :value="wheelchairAccess === 'yes'
            ? t('place.details.wheelchairAccessible')
            : t('place.details.notWheelchairAccessible')"
        />

        <!-- Smoking -->
        <DetailItem
          v-if="smokingStatus"
          :icon="CigaretteIcon"
          :value="smokingStatus === 'no'
            ? t('place.details.noSmoking')
            : smokingStatus === 'outside'
            ? t('place.details.smokingOutside')
            : t('place.details.smokingAllowed')"
        />

        <!-- Restroom Access -->
        <DetailItem
          v-if="restroomAccess || wheelchairRestroomAccess"
          :icon="ToiletIcon"
          :value="wheelchairRestroomAccess === 'yes'
            ? t('place.details.wheelchairRestroom')
            : restroomAccess === 'yes'
            ? t('place.details.hasRestroom')
            : t('place.details.noRestroom')"
        />
      </template>
    </PlaceSection>
  </div>
</template>
