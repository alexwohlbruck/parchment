<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { usePlaceService } from '@/services/place.service'
import { Spinner } from '@/components/ui/spinner'
import {
  NavigationIcon,
  ShareIcon,
  ClockIcon,
  PhoneIcon,
  GlobeIcon,
} from 'lucide-vue-next'

const route = useRoute()
const { currentPlace, loading, error, fetchPlaceDetails, clearPlace } =
  usePlaceService()

async function loadPlace(type: string, id: string) {
  clearPlace()
  await fetchPlaceDetails(id, type as any)
}

onMounted(async () => {
  const { type, id } = route.params
  if (typeof type === 'string' && typeof id === 'string') {
    await loadPlace(type, id)
  }
})

watch(
  () => route.params,
  async params => {
    const { type, id } = params
    if (typeof type === 'string' && typeof id === 'string') {
      await loadPlace(type, id)
    }
  },
)

function formatOpeningHours(hours: string) {
  return hours.split(';').join('\n')
}
</script>

<template>
  <div
    class="p-4 bg-background max-h-full overflow-y-auto shadow-md flex flex-col gap-4 rounded-md w-[400px]"
  >
    <div v-if="loading" class="flex items-center justify-center py-8">
      <Spinner class="w-6 h-6" />
    </div>

    <div v-else-if="error" class="text-destructive">
      {{ error }}
    </div>

    <template v-else-if="currentPlace">
      <!-- Header -->
      <div>
        <h1 class="text-xl font-semibold">
          {{ currentPlace.tags.name || 'Unnamed Place' }}
        </h1>
        <p
          v-if="currentPlace.tags['addr:street']"
          class="text-muted-foreground"
        >
          {{ currentPlace.tags['addr:housenumber'] }}
          {{ currentPlace.tags['addr:street'] }}
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2">
        <Button variant="outline" class="flex-1">
          <NavigationIcon class="mr-2 h-4 w-4" />
          Directions
        </Button>
        <Button variant="outline" class="flex-1">
          <ShareIcon class="mr-2 h-4 w-4" />
          Share
        </Button>
      </div>

      <!-- Details -->
      <div class="flex flex-col gap-3">
        <!-- Opening Hours -->
        <div
          v-if="currentPlace.tags.opening_hours"
          class="flex gap-3 items-start"
        >
          <ClockIcon class="w-5 h-5 mt-1 text-muted-foreground" />
          <div class="flex-1">
            <pre class="whitespace-pre-line text-sm">{{
              formatOpeningHours(currentPlace.tags.opening_hours)
            }}</pre>
          </div>
        </div>

        <!-- Phone -->
        <div v-if="currentPlace.tags.phone" class="flex gap-3 items-center">
          <PhoneIcon class="w-5 h-5 text-muted-foreground" />
          <a
            :href="`tel:${currentPlace.tags.phone}`"
            class="text-primary hover:underline"
          >
            {{ currentPlace.tags.phone }}
          </a>
        </div>

        <!-- Website -->
        <div v-if="currentPlace.tags.website" class="flex gap-3 items-center">
          <GlobeIcon class="w-5 h-5 text-muted-foreground" />
          <a
            :href="currentPlace.tags.website"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline truncate"
          >
            {{ currentPlace.tags.website }}
          </a>
        </div>
      </div>

      <!-- Additional Tags -->
      <div class="mt-4">
        <div
          v-for="(value, key) in currentPlace.tags"
          :key="key"
          class="text-sm"
          v-if="
            ![
              'name',
              'addr:street',
              'addr:housenumber',
              'opening_hours',
              'phone',
              'website',
            ].includes(key)
          "
        >
          <span class="font-medium">{{ key }}:</span> {{ value }}
        </div>
      </div>
    </template>
  </div>
</template>
