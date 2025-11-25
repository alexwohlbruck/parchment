<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { Place, TransitDeparture, TransitStopInfo } from '@/types/place.types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrainIcon, BusIcon, ClockIcon, NavigationIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { useExternalLink } from '@/composables/useExternalLink'

// Configure dayjs to handle time parsing
dayjs.extend(customParseFormat)

const props = defineProps<{
  place: Place
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()

// Real-time updates for countdown
const currentTime = ref(new Date())
let updateInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // Update every minute for real-time countdown
  updateInterval = setInterval(() => {
    currentTime.value = new Date()
  }, 60000) // Update every 60 seconds
})

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval)
  }
})

const transitInfo = computed((): TransitStopInfo | null => {
  return props.place.transit?.value || null
})

const hasTransitData = computed(() => {
  return transitInfo.value && transitInfo.value.onestopId
})

const departures = computed((): TransitDeparture[] => {
  const allDepartures = transitInfo.value?.departures || []
  return allDepartures
})

const groupedDepartures = computed(() => {
  if (!departures.value.length) return {}
  
  const groups: Record<string, Record<string, TransitDeparture[]>> = {}
  
  departures.value.forEach(departure => {
    const routeKey = `${departure.route.shortName || departure.route.longName || departure.route.id}`
    const direction = departure.direction || departure.headsign || t('place.transit.unknownDirection')
    
    if (!groups[routeKey]) {
      groups[routeKey] = {}
    }
    
    if (!groups[routeKey][direction]) {
      groups[routeKey][direction] = []
    }
    
    groups[routeKey][direction].push(departure)
  })
  
  // Sort departures within each group by departure time
  Object.keys(groups).forEach(routeKey => {
    Object.keys(groups[routeKey]).forEach(direction => {
      groups[routeKey][direction].sort((a, b) => {
        const timeAStr = a.departureTime || a.arrivalTime
        const timeBStr = b.departureTime || b.arrivalTime
        
        if (!timeAStr || !timeBStr) return 0
        
        // Parse times and compare
        const timeA = dayjs(timeAStr, 'HH:mm:ss')
        const timeB = dayjs(timeBStr, 'HH:mm:ss')
        
        if (!timeA.isValid() || !timeB.isValid()) return 0
        
        return timeA.diff(timeB)
      })
    })
  })
  
  return groups
})

function formatTime(timeString?: string): string {
  if (!timeString) return '--'
  
  try {
    // Parse time in HH:MM:SS format and combine with today's date
    const today = dayjs()
    const time = dayjs(timeString, 'HH:mm:ss')
    
    if (!time.isValid()) return '--'
    
    // Create a datetime for today with the parsed time
    const datetime = today.hour(time.hour()).minute(time.minute()).second(time.second())
    
    return datetime.format('HH:mm')
  } catch {
    return '--'
  }
}

function getMinutesUntil(timeString?: string): number | null {
  if (!timeString) return null
  
  try {
    // Parse time in HH:MM:SS format and combine with today's date
    // Use reactive currentTime for real-time updates
    const now = dayjs(currentTime.value)
    const time = dayjs(timeString, 'HH:mm:ss')
    
    if (!time.isValid()) return null
    
    // Create a datetime for today with the parsed time
    let datetime = now.hour(time.hour()).minute(time.minute()).second(time.second())
    
    // Calculate the difference in minutes
    let diffInMinutes = datetime.diff(now, 'minute')
    
    // If the time has passed today, calculate for tomorrow
    if (diffInMinutes < 0) {
      datetime = datetime.add(1, 'day')
      diffInMinutes = datetime.diff(now, 'minute')
    }
    
    return diffInMinutes
  } catch {
    return null
  }
}

function formatMinutesUntil(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes <= 0) return t('place.transit.now')
  if (minutes === 1) return `1 ${t('place.transit.min')}`
  if (minutes > 1440) {
    // More than 24 hours - probably tomorrow's schedule
    const days = Math.floor(minutes / 1440)
    const remainingMinutes = minutes % 1440
    const remainingHours = Math.floor(remainingMinutes / 60)
    const mins = remainingMinutes % 60
    if (days === 1) {
      return `Tomorrow ${String(Math.floor(remainingMinutes / 60)).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    }
    return `${days}d ${remainingHours}h`
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  return `${minutes} ${t('place.transit.min')}`
}

function getRouteTypeIcon(routeType?: number): any {
  // GTFS route types: 0=Tram, 1=Subway, 2=Rail, 3=Bus, 4=Ferry, etc.
  switch (routeType) {
    case 0: // Tram
    case 1: // Subway  
    case 2: // Rail
      return TrainIcon
    case 3: // Bus
    default:
      return BusIcon
  }
}

function getRouteColor(route: TransitDeparture['route']): string {
  if (route.color) {
    return `#${route.color.replace('#', '')}`
  }
  
  
  // Fallback to app's primary color for all transit routes
  return 'hsl(var(--primary))'
}

function getTextColor(route: TransitDeparture['route']): string {
  if (route.textColor) {
    return `#${route.textColor.replace('#', '')}`
  }
  
  // Default to white text for all routes
  return '#FFFFFF'
}

function getDepartureTimeStyle(departure: TransitDeparture): Record<string, string> {
  const minutes = getMinutesUntil(departure.departureTime || departure.arrivalTime)
  
  if (minutes === null) {
    // No time data - use neutral styling
    return {}
  }
  
  if (minutes <= 5) {
    // Imminent departure - green
    return {
      borderColor: '#10b981', // green-500
      backgroundColor: '#ecfdf5', // green-50
      color: '#047857' // green-700
    }
  } else if (minutes <= 15) {
    // Soon departure - amber
    return {
      borderColor: '#f59e0b', // amber-500
      backgroundColor: '#fffbeb', // amber-50
      color: '#d97706' // amber-700
    }
  } else {
    // Later departure - neutral
    return {}
  }
}

function openTransitlandLink() {
  if (transitInfo.value?.onestopId) {
    openExternalLink(`https://www.transit.land/stops/${transitInfo.value.onestopId}`, '_blank')
  }
}
</script>

<template>
  <div v-if="hasTransitData" class="space-y-3">
    <Card>
      <CardHeader class="p-3 pb-0">
        <div class="flex items-center justify-between">
          <CardTitle class="flex items-center gap-2 text-lg">
            <TrainIcon 
              class="h-5 w-5" 
              :style="departures.length > 0 ? { color: getRouteColor(departures[0].route) } : {}"
            />
            {{ transitInfo?.name || t('place.transit.transitStop') }}
          </CardTitle>
          <button
            v-if="transitInfo?.onestopId"
            @click="openTransitlandLink"
            class="text-muted-foreground hover:text-foreground transition-colors"
            :title="t('place.transit.viewOnTransitland')"
          >
            <ExternalLinkIcon class="h-4 w-4" />
          </button>
        </div>
        <div v-if="transitInfo?.code" class="text-sm text-muted-foreground">
          Stop ID: {{ transitInfo.code }}
        </div>
      </CardHeader>

      <CardContent class="p-3 space-y-4">
        <!-- Departures Section -->
        <div v-if="Object.keys(groupedDepartures).length > 0">
          <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
            <ClockIcon class="h-4 w-4" />
            {{ t('place.transit.upcomingDepartures') }}
          </h4>
          
          <div class="space-y-4">
            <div 
              v-for="(directions, routeKey) in groupedDepartures" 
              :key="routeKey"
              class="space-y-2"
            >
              <!-- Route Header -->
              <div class="flex items-center gap-2">
                <Badge 
                  :style="{
                    backgroundColor: getRouteColor(Object.values(directions)[0][0].route),
                    color: getTextColor(Object.values(directions)[0][0].route)
                  }"
                  class="text-xs font-semibold"
                >
                  {{ routeKey }}
                </Badge>
                <span class="text-sm text-muted-foreground">
                  {{ Object.values(directions)[0][0].route.longName }}
                </span>
              </div>

              <!-- Directions -->
              <div 
                class="space-y-2 ml-2 pl-3 border-l-2"
                :style="{
                  borderLeftColor: getRouteColor(Object.values(directions)[0][0].route)
                }"
              >
                <div 
                  v-for="(departureList, direction) in directions" 
                  :key="`${routeKey}-${direction}`"
                  class="space-y-1"
                >
                  <!-- Direction Header -->
                  <div class="flex items-center gap-2 text-sm">
                    <NavigationIcon 
                      class="h-3 w-3" 
                      :style="{ color: getRouteColor(departureList[0].route) }"
                    />
                    <span class="font-medium">{{ direction }}</span>
                  </div>

                  <!-- Departure Times -->
                  <div class="flex flex-wrap gap-2 ml-5">
                    <div
                      v-for="(departure, index) in departureList.slice(0, 4)"
                      :key="`${routeKey}-${direction}-${index}`"
                      class="flex items-center gap-1 text-xs"
                    >
                      <Badge 
                        variant="outline" 
                        class="font-mono border-1"
                        :style="getDepartureTimeStyle(departure)"
                      >
                        {{ formatTime(departure.departureTime || departure.arrivalTime) }}
                      </Badge>
                      <span 
                        v-if="getMinutesUntil(departure.departureTime || departure.arrivalTime) !== null"
                        class="text-muted-foreground text-xs"
                      >
                        {{ formatMinutesUntil(getMinutesUntil(departure.departureTime || departure.arrivalTime)) }}
                      </span>
                      <span 
                        v-if="departure.realTime"
                        class="text-xs font-medium"
                        :style="{ color: getRouteColor(departure.route) }"
                        :title="t('place.transit.realTimeData')"
                      >
                        {{ t('place.transit.live') }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No Departures -->
        <div v-else class="text-center py-6 text-muted-foreground">
          <ClockIcon class="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">{{ t('place.transit.noUpcomingDepartures') }}</p>
          <p class="text-xs mt-1">{{ t('place.transit.checkBackLater') }}</p>
        </div>

        <!-- Agency Info -->
        <div v-if="departures.length > 0 && departures[0].agency" class="pt-3 border-t border-border">
          <div class="text-xs text-muted-foreground">
            Operated by 
            <a 
              v-if="departures[0].agency?.url"
              :href="departures[0].agency.url"
              target="_blank"
              class="text-primary hover:underline"
            >
              {{ departures[0].agency.name }}
            </a>
            <span v-else class="text-foreground">{{ departures[0].agency.name }}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
