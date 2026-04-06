<script setup lang="ts">
/**
 * TODO: Regional AQI Scales
 * Currently we only support two AQI scales:
 * - European CAQI (1-5 scale) for metric users
 * - US EPA AQI (0-500 scale) for imperial users
 *
 * Future enhancement: Add support for regional AQI scales based on user location:
 *
 * Key Regional AQI Differences:
 * - U.S. EPA AQI (0-500): Often used internationally (e.g., AirNow, PurpleAir).
 *   Stricter for lower pollutant levels (PM2.5 below 9 μg/m³ is "Good").
 *
 * - China AQI (0-500): Different, sometimes more linear calculation.
 *   Less strict than US at lower concentrations but comparable at higher levels.
 *
 * - India NAQI (0-500): 6-category scale similar to US, but with higher breakpoints
 *   for "Good" or "Satisfactory" levels, allowing higher pollutant levels before
 *   labeling air "Unhealthy".
 *
 * - EU CAQI (0-100): Focuses on 0-100 scale, often separating measurements for
 *   roadside vs background locations, with lower, stricter numerical indices.
 *
 * - Canada AQHI (0-10+): Air Quality Health Index representing health risks rather
 *   than just pollutant concentrations, usually ranging from 0-10+.
 *
 * Implementation approach:
 * 1. Add user preference or auto-detect based on location
 * 2. Implement conversion functions for each regional scale
 * 3. Update UI labels and color scales accordingly
 * 4. Consider adding PM2.5/PM10 concentration display as fallback
 */
import { computed, ref } from 'vue'
import { useWeatherService } from '@/services/weather.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useMapStore } from '@/stores/map.store'
import { usePreferencesStore } from '@/stores/preferences.store'
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
const preferencesStore = usePreferencesStore()

const { weather, loading } = weatherService
const { controlSettings } = storeToRefs(mapStore)
const { unitSystem } = storeToRefs(preferencesStore)

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

// Calculate US EPA AQI from PM2.5 (μg/m³)
// https://www.airnow.gov/aqi/aqi-calculator-concentration/
function calculateUSAQI(pm25: number): number {
  // PM2.5 breakpoints and corresponding AQI values
  const breakpoints = [
    { pm_low: 0.0, pm_high: 12.0, aqi_low: 0, aqi_high: 50 },
    { pm_low: 12.1, pm_high: 35.4, aqi_low: 51, aqi_high: 100 },
    { pm_low: 35.5, pm_high: 55.4, aqi_low: 101, aqi_high: 150 },
    { pm_low: 55.5, pm_high: 150.4, aqi_low: 151, aqi_high: 200 },
    { pm_low: 150.5, pm_high: 250.4, aqi_low: 201, aqi_high: 300 },
    { pm_low: 250.5, pm_high: 350.4, aqi_low: 301, aqi_high: 400 },
    { pm_low: 350.5, pm_high: 500.4, aqi_low: 401, aqi_high: 500 },
  ]

  for (const bp of breakpoints) {
    if (pm25 >= bp.pm_low && pm25 <= bp.pm_high) {
      const aqi =
        ((bp.aqi_high - bp.aqi_low) / (bp.pm_high - bp.pm_low)) *
          (pm25 - bp.pm_low) +
        bp.aqi_low
      return Math.round(aqi)
    }
  }

  // If PM2.5 is above the highest breakpoint
  return 500
}

const aqiLevel = computed(() => {
  if (unitSystem.value === UnitSystem.METRIC) {
    // Use OpenWeatherMap's European AQI scale (1-5)
    return weather.value?.aqi ?? null
  } else {
    // Use US EPA AQI scale (0-500) calculated from PM2.5
    if (!weather.value?.aqiComponents?.pm2_5) return null
    return calculateUSAQI(weather.value.aqiComponents.pm2_5)
  }
})

const aqiBadgeClass = computed(() => {
  const aqi = aqiLevel.value
  if (!aqi) return ''

  if (unitSystem.value === UnitSystem.METRIC) {
    // European AQI color scale (1-5)
    if (aqi === 1) return 'bg-green-500 text-white' // Good
    if (aqi === 2) return 'bg-yellow-400 text-white' // Fair
    if (aqi === 3) return 'bg-orange-500 text-white' // Moderate
    if (aqi === 4) return 'bg-red-500 text-white' // Poor
    return 'bg-purple-600 text-white' // Very Poor (5)
  } else {
    // US EPA AQI color scale (0-500)
    if (aqi <= 50) return 'bg-green-500 text-white' // Good
    if (aqi <= 100) return 'bg-yellow-400 text-white' // Moderate
    if (aqi <= 150) return 'bg-orange-500 text-white' // Unhealthy for Sensitive Groups
    if (aqi <= 200) return 'bg-red-500 text-white' // Unhealthy
    if (aqi <= 300) return 'bg-purple-600 text-white' // Very Unhealthy
    return 'bg-maroon-800 text-white' // Hazardous
  }
})

const aqiLabel = computed(() => {
  const aqi = aqiLevel.value
  if (!aqi) return ''

  if (unitSystem.value === UnitSystem.METRIC) {
    // European AQI descriptive labels (1-5)
    if (aqi === 1) return 'Good'
    if (aqi === 2) return 'Fair'
    if (aqi === 3) return 'Moderate'
    if (aqi === 4) return 'Poor'
    return 'Very Poor' // 5
  } else {
    // US EPA AQI descriptive labels (0-500)
    if (aqi <= 50) return 'Good'
    if (aqi <= 100) return 'Moderate'
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups'
    if (aqi <= 200) return 'Unhealthy'
    if (aqi <= 300) return 'Very Unhealthy'
    return 'Hazardous'
  }
})
</script>

<template>
  <TransitionFade>
    <Button
      v-if="isVisible"
      variant="outline"
      class="weather-control h-auto px-2 py-1.5 flex flex-col gap-0.5 items-center justify-center min-w-[3rem]"
      :title="`${weather?.conditionDescription}, ${temperature}${temperatureUnit}${aqiLevel ? ` • Air Quality: ${aqiLabel}` : ''}`"
      @click="showDetailsDialog = true"
    >
      <!-- Weather Icon and Temperature -->
      <div class="flex items-center gap-1">
        <component :is="weatherIcon" class="h-4 w-4" :stroke-width="2" />
        <span class="text-sm font-bold leading-none"> {{ temperature }}° </span>
      </div>

      <!-- AQI Badge -->
      <div v-if="aqiLevel" class="flex items-center gap-1 mt-0.5">
        <span class="text-[0.5rem] font-medium opacity-60 leading-none"
          >AQI</span
        >
        <span class="text-[0.5rem] font-bold leading-none">
          {{ aqiLevel }}
        </span>
        <!-- Color indicator dot -->
        <div
          class="w-1.5 h-1.5 rounded-full"
          :class="aqiBadgeClass.split(' ')[0]"
        />
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
