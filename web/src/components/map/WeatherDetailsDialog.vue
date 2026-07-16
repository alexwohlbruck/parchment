<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'
import { storeToRefs } from 'pinia'
import type { WeatherData } from '@server/types/integration.types'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { aqiSeverityClass } from '@/lib/aqi-colors'
import {
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudDrizzle,
  CloudLightning,
  CloudFog,
  CloudHail,
  CloudSun,
  CloudMoon,
  CloudSunRain,
  CloudRainWind,
  Wind,
  Snowflake,
  Droplets,
  Gauge,
  Eye,
  Waves,
  Sunrise,
  Sunset,
  Thermometer,
  type LucideIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  weather: WeatherData | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const appStore = useAppStore()
const { unitSystem } = storeToRefs(appStore)

// Get weather icon based on condition
const getWeatherIcon = (weather: WeatherData | null): LucideIcon => {
  if (!weather) return Sun

  const condition = weather.condition.toLowerCase()
  const description = weather.conditionDescription.toLowerCase()
  const icon = weather.conditionIcon
  const isNight = icon.includes('n')

  // Thunderstorm (Group 2xx)
  if (condition.includes('thunderstorm') || condition.includes('storm')) {
    return CloudLightning
  }

  // Drizzle (Group 3xx)
  if (condition.includes('drizzle')) {
    return CloudDrizzle
  }

  // Rain (Group 5xx)
  if (condition.includes('rain')) {
    if (description.includes('freezing')) {
      return CloudHail
    }
    if (description.includes('heavy') || description.includes('extreme')) {
      return CloudRainWind
    }
    if (description.includes('light') && (description.includes('sun') || isNight === false)) {
      return CloudSunRain
    }
    return CloudRain
  }

  // Snow (Group 6xx)
  if (condition.includes('snow')) {
    if (description.includes('sleet') || description.includes('rain')) {
      return CloudHail
    }
    if (description.includes('heavy')) {
      return Snowflake
    }
    return CloudSnow
  }

  // Atmosphere (Group 7xx)
  if (
    condition.includes('mist') ||
    condition.includes('fog') ||
    condition.includes('haze') ||
    condition.includes('dust') ||
    condition.includes('sand') ||
    condition.includes('ash')
  ) {
    return CloudFog
  }
  if (condition.includes('squall') || condition.includes('tornado')) {
    return Wind
  }
  if (condition.includes('smoke')) {
    return CloudFog
  }

  // Clouds (Group 8xx)
  if (condition.includes('clouds') || condition.includes('cloud')) {
    if (description.includes('few') || description.includes('scattered')) {
      return isNight ? CloudMoon : CloudSun
    }
    return Cloud
  }

  // Clear (Group 800)
  if (condition.includes('clear')) {
    return isNight ? Moon : Sun
  }

  return isNight ? Moon : Sun
}

// Temperature conversions
const temperature = computed(() => {
  if (!props.weather) return '–'
  const temp = props.weather.temperature
  if (temp === null || temp === undefined || isNaN(temp)) return '–'

  if (unitSystem.value === UnitSystem.IMPERIAL) {
    return Math.round((temp * 9 / 5) + 32)
  }

  return Math.round(temp)
})

const feelsLike = computed(() => {
  if (!props.weather?.temperatureFeelsLike) return null
  const temp = props.weather.temperatureFeelsLike

  if (unitSystem.value === UnitSystem.IMPERIAL) {
    return Math.round((temp * 9 / 5) + 32)
  }

  return Math.round(temp)
})

const temperatureMin = computed(() => {
  if (!props.weather?.temperatureMin) return null
  const temp = props.weather.temperatureMin

  if (unitSystem.value === UnitSystem.IMPERIAL) {
    return Math.round((temp * 9 / 5) + 32)
  }

  return Math.round(temp)
})

const temperatureMax = computed(() => {
  if (!props.weather?.temperatureMax) return null
  const temp = props.weather.temperatureMax

  if (unitSystem.value === UnitSystem.IMPERIAL) {
    return Math.round((temp * 9 / 5) + 32)
  }

  return Math.round(temp)
})

const temperatureUnit = computed(() => {
  return unitSystem.value === UnitSystem.IMPERIAL ? '°F' : '°C'
})

// Wind speed conversion
const windSpeed = computed(() => {
  if (!props.weather?.windSpeed) return null
  const speed = props.weather.windSpeed // m/s from API

  if (unitSystem.value === UnitSystem.IMPERIAL) {
    // Convert m/s to mph
    return Math.round(speed * 2.237)
  }

  // Convert m/s to km/h for metric
  return Math.round(speed * 3.6)
})

const windSpeedUnit = computed(() => {
  return unitSystem.value === UnitSystem.IMPERIAL ? 'mph' : 'km/h'
})

// Wind direction
const windDirection = computed(() => {
  if (!props.weather?.windDirection) return null
  const deg = props.weather.windDirection

  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(deg / 22.5) % 16
  return directions[index]
})

// Visibility conversion
const visibility = computed(() => {
  if (!props.weather?.visibility) return null
  const vis = props.weather.visibility // meters from API

  if (unitSystem.value === UnitSystem.IMPERIAL) {
    // Convert meters to miles
    const miles = vis / 1609.34
    return miles >= 10 ? Math.round(miles) : miles.toFixed(1)
  }

  // Convert meters to km for metric
  const km = vis / 1000
  return km >= 10 ? Math.round(km) : km.toFixed(1)
})

const visibilityUnit = computed(() => {
  return unitSystem.value === UnitSystem.IMPERIAL ? 'mi' : 'km'
})

// Air quality is computed server-side using the location's regional standard,
// preferring a nearby OpenAQ ground station over the model. See lib/aqi.ts.
const airQuality = computed(() => props.weather?.airQuality ?? null)

const aqiColor = computed(() =>
  airQuality.value
    ? aqiSeverityClass(airQuality.value.severity)
    : 'bg-muted-foreground',
)

// Format time
const formatTime = (isoString: string | undefined) => {
  if (!isoString) return null
  const date = new Date(isoString)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const sunriseTime = computed(() => formatTime(props.weather?.sunrise))
const sunsetTime = computed(() => formatTime(props.weather?.sunset))

const weatherIcon = computed(() => getWeatherIcon(props.weather))
</script>

<template>
  <ResponsiveDialog
    :open="open"
    @update:open="emit('update:open', $event)"
    content-class="max-w-lg p-0 overflow-hidden"
    :no-padding="true"
    :fit-content="true"
  >
    <template #trigger>
      <div style="display: none" />
    </template>
    <template #content>
      <div v-if="weather" class="flex flex-col">
        <!-- Title Section -->
        <div class="px-5 pt-5 pb-3">
          <h2 class="text-lg font-semibold">
            {{ weather.locationName || $t('weather.title') }}
          </h2>
          <p class="text-sm text-muted-foreground mt-0.5">{{ $t('weather.subtitle') }}</p>
        </div>

        <!-- Main Weather Display -->
        <div class="px-5 py-3 border-t border-border/50">
          <div class="flex items-start gap-3">
            <div class="rounded-lg border border-border/50 bg-muted/30 p-2.5">
              <component
                :is="weatherIcon"
                class="h-9 w-9 text-foreground"
                :stroke-width="2"
              />
            </div>
            <div>
              <div class="text-4xl font-semibold tracking-tight tabular-nums leading-none">
                {{ temperature }}°
              </div>
              <div class="text-sm text-muted-foreground mt-1.5 capitalize font-medium">
                {{ weather.conditionDescription }}
              </div>
              <!-- High/Low if available -->
              <div v-if="temperatureMin !== null && temperatureMax !== null" class="flex items-center gap-2.5 text-xs text-muted-foreground mt-1.5">
                <div>
                  <span class="font-semibold">H:</span> {{ temperatureMax }}°
                </div>
                <div>
                  <span class="font-semibold">L:</span> {{ temperatureMin }}°
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Details Grid -->
        <div class="p-4 space-y-3">
          <!-- Air Quality (if available) -->
          <div v-if="airQuality" class="rounded-lg border border-border/50 p-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex-1">
                <div class="flex items-center gap-1.5 mb-1.5">
                  <Waves class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                  <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.airQuality') }}</span>
                </div>
                <div class="text-2xl font-semibold">
                  {{ $t('weather.aqi.levels.' + airQuality.severity) }}
                </div>
                <div class="text-xs text-muted-foreground/80 mt-1">
                  {{ airQuality.index }} · {{ $t('weather.aqi.standards.' + airQuality.standard) }} · {{ $t('weather.aqi.dominant') }}: {{ $t('weather.aqi.pollutants.' + airQuality.dominant) }}
                </div>
                <div class="text-[0.65rem] text-muted-foreground/70 mt-0.5">
                  {{
                    airQuality.source === 'openaq' && airQuality.stationName
                      ? airQuality.stationName
                      : $t('weather.aqi.modeled')
                  }}
                </div>
              </div>
              <div class="w-2 h-2 rounded-full shrink-0" :class="aqiColor" />
            </div>
          </div>

          <!-- Weather Metrics Grid -->
          <div class="grid grid-cols-2 gap-2.5">
            <!-- Feels Like -->
            <div v-if="feelsLike !== null" class="rounded-lg border border-border/50 p-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Thermometer class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.feelsLike') }}</span>
              </div>
              <div class="text-xl font-semibold tabular-nums">
                {{ feelsLike }}<span class="text-sm text-muted-foreground font-normal">{{ temperatureUnit }}</span>
              </div>
            </div>

            <!-- Humidity -->
            <div v-if="weather.humidity" class="rounded-lg border border-border/50 p-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Droplets class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.humidity') }}</span>
              </div>
              <div class="text-xl font-semibold tabular-nums">
                {{ weather.humidity }}<span class="text-sm text-muted-foreground font-normal">%</span>
              </div>
            </div>

            <!-- Wind -->
            <div v-if="windSpeed !== null" class="rounded-lg border border-border/50 p-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Wind class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.wind') }}</span>
              </div>
              <div class="flex items-baseline gap-1">
                <div class="text-xl font-semibold tabular-nums">{{ windSpeed }}</div>
                <span class="text-xs text-muted-foreground font-medium">{{ windSpeedUnit }}</span>
                <span v-if="windDirection" class="text-xs text-muted-foreground font-medium ml-0.5">{{ windDirection }}</span>
              </div>
            </div>

            <!-- Visibility -->
            <div v-if="visibility !== null" class="rounded-lg border border-border/50 p-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Eye class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.visibility') }}</span>
              </div>
              <div class="flex items-baseline gap-1">
                <div class="text-xl font-semibold tabular-nums">{{ visibility }}</div>
                <span class="text-xs text-muted-foreground font-medium">{{ visibilityUnit }}</span>
              </div>
            </div>

            <!-- Pressure -->
            <div v-if="weather.pressure" class="rounded-lg border border-border/50 p-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Gauge class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.pressure') }}</span>
              </div>
              <div class="flex items-baseline gap-1">
                <div class="text-xl font-semibold tabular-nums">{{ weather.pressure }}</div>
                <span class="text-xs text-muted-foreground font-medium">hPa</span>
              </div>
            </div>

            <!-- Cloudiness -->
            <div v-if="weather.cloudiness !== null && weather.cloudiness !== undefined" class="rounded-lg border border-border/50 p-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Cloud class="h-3.5 w-3.5 text-muted-foreground" :stroke-width="2" />
                <span class="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{{ $t('weather.cloudiness') }}</span>
              </div>
              <div class="text-xl font-semibold tabular-nums">
                {{ weather.cloudiness }}<span class="text-sm text-muted-foreground font-normal">%</span>
              </div>
            </div>
          </div>

          <!-- Sunrise/Sunset -->
          <div v-if="sunriseTime || sunsetTime" class="rounded-lg border border-border/50 p-3">
            <div class="flex items-center justify-around divide-x divide-border/50">
              <div v-if="sunriseTime" class="flex items-center gap-2.5 flex-1 justify-center">
                <Sunrise class="h-4 w-4 text-muted-foreground" :stroke-width="2" />
                <div>
                  <div class="text-[0.6875rem] text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">{{ $t('weather.sunrise') }}</div>
                  <div class="text-sm font-semibold tabular-nums">{{ sunriseTime }}</div>
                </div>
              </div>
              <div v-if="sunsetTime" class="flex items-center gap-2.5 flex-1 justify-center">
                <Sunset class="h-4 w-4 text-muted-foreground" :stroke-width="2" />
                <div>
                  <div class="text-[0.6875rem] text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">{{ $t('weather.sunset') }}</div>
                  <div class="text-sm font-semibold tabular-nums">{{ sunsetTime }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
