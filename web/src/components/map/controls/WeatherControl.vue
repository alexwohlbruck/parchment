<script setup lang="ts">
/**
 * Air quality is computed server-side using the regional standard for the
 * location's country (US EPA, EEA, UK DAQI, China, India, Canada AQHI) and
 * delivered on `weather.airQuality`. See server/src/lib/aqi.ts.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { aqiSeverityClass } from '@/lib/aqi-colors'
import { useWeatherService } from '@/services/weather.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useMapStore } from '@/stores/map.store'
import { useAppStore } from '@/stores/app.store'
import { Button } from '@/components/ui/button'
import { ControlVisibility, UnitSystem } from '@/types/map.types'
import { storeToRefs } from 'pinia'
import WeatherDetailsDialog from '@/components/map/WeatherDetailsDialog.vue'
import { TransitionFade } from '@morev/vue-transitions'
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
  type LucideIcon,
} from 'lucide-vue-next'

const weatherService = useWeatherService()
const integrationsStore = useIntegrationsStore()
const mapStore = useMapStore()
const appStore = useAppStore()

const { t } = useI18n()
const { weather, loading } = weatherService
const { controlSettings } = storeToRefs(mapStore)
const { unitSystem } = storeToRefs(appStore)

const showDetailsDialog = ref(false)

// Only show if: control is enabled, integration is active, AND we have weather data
const isVisible = computed(() => {
  return (
    controlSettings.value.weather === ControlVisibility.ALWAYS &&
    integrationsStore.isWeatherActive &&
    weather.value !== null &&
    !loading.value
  )
})

const temperature = computed(() => {
  if (!weather.value) return '–'
  const temp = weather.value.temperature
  if (temp === null || temp === undefined || isNaN(temp)) return '–'

  // Convert to Fahrenheit if imperial
  if (unitSystem.value === UnitSystem.IMPERIAL) {
    return Math.round((temp * 9) / 5 + 32)
  }

  return Math.round(temp)
})

const temperatureUnit = computed(() => {
  return unitSystem.value === UnitSystem.IMPERIAL ? '°F' : '°C'
})

// Map OpenWeatherMap condition to Lucide icon
const weatherIcon = computed((): LucideIcon => {
  if (!weather.value) return Sun

  const condition = weather.value.condition.toLowerCase()
  const description = weather.value.conditionDescription.toLowerCase()
  const icon = weather.value.conditionIcon

  // Check if it's night time (icons ending with 'n')
  const isNight = icon?.endsWith('n')

  // Thunderstorm (Group 2xx)
  if (
    condition.includes('thunderstorm') ||
    condition.includes('thunder') ||
    condition.includes('storm')
  ) {
    return CloudLightning
  }

  // Drizzle (Group 3xx)
  if (condition.includes('drizzle')) {
    // Light drizzle with partial clouds
    if (description.includes('light') && !isNight) {
      return CloudSunRain
    }
    return CloudDrizzle
  }

  // Rain (Group 5xx)
  if (condition.includes('rain')) {
    // Freezing rain or sleet
    if (description.includes('freezing') || description.includes('sleet')) {
      return CloudHail
    }
    // Light rain with sun
    if (
      (description.includes('light') || description.includes('shower')) &&
      !isNight
    ) {
      return CloudSunRain
    }
    // Heavy rain or windy rain
    if (
      description.includes('heavy') ||
      description.includes('extreme') ||
      description.includes('ragged')
    ) {
      return CloudRainWind
    }
    return CloudRain
  }

  // Snow (Group 6xx)
  if (condition.includes('snow')) {
    // Sleet or rain and snow
    if (description.includes('sleet') || description.includes('rain')) {
      return CloudHail
    }
    // Light snow
    if (description.includes('light')) {
      return CloudSnow
    }
    // Heavy snow
    if (description.includes('heavy')) {
      return Snowflake
    }
    return CloudSnow
  }

  // Atmosphere (Group 7xx) - fog, mist, haze, dust, sand, smoke, ash, squall, tornado
  if (
    condition.includes('mist') ||
    condition.includes('fog') ||
    condition.includes('haze')
  ) {
    return CloudFog
  }
  if (
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
    // Few clouds (11-25%) or scattered clouds (25-50%)
    if (description.includes('few') || description.includes('scattered')) {
      return isNight ? CloudMoon : CloudSun
    }
    // Broken clouds (51-84%) or overcast (85-100%)
    return Cloud
  }

  // Clear (Group 800)
  if (condition.includes('clear')) {
    return isNight ? Moon : Sun
  }

  // Default fallback
  return isNight ? Moon : Sun
})

// Server-computed regional air quality (null when unavailable)
const airQuality = computed(() => weather.value?.airQuality ?? null)

const aqiColor = computed(() =>
  airQuality.value
    ? aqiSeverityClass(airQuality.value.severity)
    : 'bg-muted-foreground',
)

// Single friendly word derived from the normalized 1–6 severity
const aqiLabel = computed(() => {
  const severity = airQuality.value?.severity
  return severity ? t(`weather.aqi.levels.${severity}`) : ''
})
</script>

<template>
  <TransitionFade>
    <Button
      v-if="isVisible"
      variant="outline"
      class="weather-control h-auto px-2 py-1.5 flex flex-col gap-0.5 items-center justify-center min-w-[3rem]"
      :title="`${weather?.conditionDescription}, ${temperature}${temperatureUnit}${airQuality ? ` • ${$t('weather.airQuality')}: ${aqiLabel}` : ''}`"
      @click="showDetailsDialog = true"
    >
      <!-- Weather Icon and Temperature -->
      <div class="flex items-center gap-1">
        <component :is="weatherIcon" class="h-4 w-4" :stroke-width="2" />
        <span class="text-sm font-bold leading-none"> {{ temperature }}° </span>
      </div>

      <!-- AQI: descriptive word + color dot -->
      <div v-if="airQuality" class="flex items-center gap-1 mt-0.5">
        <span class="text-[0.5rem] font-bold leading-none">
          {{ aqiLabel }}
        </span>
        <!-- Color indicator dot -->
        <div class="w-1.5 h-1.5 rounded-full" :class="aqiColor" />
      </div>
    </Button>
  </TransitionFade>

  <!-- Weather Details Dialog -->
  <WeatherDetailsDialog v-model:open="showDetailsDialog" :weather="weather" />
</template>

<style scoped>
.weather-control {
  @apply pointer-events-auto;
}
</style>
