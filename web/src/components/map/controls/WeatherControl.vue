<script setup lang="ts">
import { computed } from 'vue'
import { useWeatherService } from '@/services/weather.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { Button } from '@/components/ui/button'
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
  type LucideIcon
} from 'lucide-vue-next'

const weatherService = useWeatherService()
const integrationsStore = useIntegrationsStore()

const { weather, loading } = weatherService

// Only show if weather integration is active AND we have weather data
const isVisible = computed(() => {
  return integrationsStore.isWeatherActive && weather.value !== null && !loading.value
})

const temperature = computed(() => {
  if (!weather.value) return '–'
  const temp = weather.value.temperature
  if (temp === null || temp === undefined || isNaN(temp)) return '–'
  return Math.round(temp)
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
  if (condition.includes('thunderstorm') || condition.includes('thunder') || condition.includes('storm')) {
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
    if ((description.includes('light') || description.includes('shower')) && !isNight) {
      return CloudSunRain
    }
    // Heavy rain or windy rain
    if (description.includes('heavy') || description.includes('extreme') || description.includes('ragged')) {
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
  if (condition.includes('mist') || condition.includes('fog') || condition.includes('haze')) {
    return CloudFog
  }
  if (condition.includes('dust') || condition.includes('sand') || condition.includes('ash')) {
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

const aqiLevel = computed(() => {
  if (!weather.value?.aqi) return null
  return weather.value.aqi
})

const aqiBadgeClass = computed(() => {
  if (!weather.value?.aqi) return ''
  const aqi = weather.value.aqi
  // AQI scale: 1=Good, 2=Fair, 3=Moderate, 4=Poor, 5=Very Poor
  if (aqi <= 1) return 'bg-green-500 text-white'
  if (aqi === 2) return 'bg-lime-400 text-white'
  if (aqi === 3) return 'bg-amber-500 text-white'
  if (aqi === 4) return 'bg-red-500 text-white'
  return 'bg-red-900 text-white'
})

const aqiLabel = computed(() => {
  if (!weather.value?.aqi) return ''
  const aqi = weather.value.aqi
  if (aqi <= 1) return 'Good'
  if (aqi === 2) return 'Fair'
  if (aqi === 3) return 'Moderate'
  if (aqi === 4) return 'Poor'
  return 'Very Poor'
})
</script>

<template>
  <transition name="fade">
    <Button
      v-if="isVisible"
      variant="outline"
      class="weather-control h-auto px-2 py-1.5 flex flex-col gap-0.5 items-center justify-center min-w-[3rem]"
      :title="`${weather?.conditionDescription}, ${temperature}°C${aqiLevel ? ` • Air Quality: ${aqiLabel}` : ''}`"
    >
      <!-- Weather Icon and Temperature -->
      <div class="flex items-center gap-1">
        <component 
          :is="weatherIcon" 
          class="h-4 w-4"
          :stroke-width="2"
        />
        <span class="text-sm font-bold leading-none">
          {{ temperature }}°
        </span>
      </div>

      <!-- AQI Badge -->
      <div
        v-if="aqiLevel"
        class="flex items-center gap-1 mt-0.5"
      >
        <span class="text-[0.5rem] font-medium opacity-60 leading-none">AQI</span>
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
  </transition>
</template>

<style scoped>
.weather-control {
  @apply pointer-events-auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
