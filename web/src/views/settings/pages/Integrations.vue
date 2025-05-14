<script setup lang="ts">
import { Card } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import { SettingsSection } from '@/components/settings'
import { useAppService } from '@/services/app.service'
import { ref, computed } from 'vue'
import IntegrationForm from './IntegrationForm.vue'
import {
  siGooglemaps,
  siOpenstreetmap,
  siYelp,
  siFoursquare,
  siMapillary,
  siTripadvisor,
} from 'simple-icons'
import { Cloud } from 'lucide-vue-next'
import type { Integration } from '@/types/integrations.types'
import {
  apiKeySchema,
  hostConfigSchema,
  oauthConfigSchema,
} from '@/types/integrations.types'
import { z } from 'zod'

const { t } = useI18n()
const appService = useAppService()

// Custom schemas for specific integrations
const nominatimSchema = z.object({
  host: z
    .string()
    .url('Please enter a valid URL')
    .default('https://nominatim.openstreetmap.org'),
  email: z.string().email('Please enter a valid email for usage tracking'),
  enabled: z.boolean().default(true),
})

const googleMapsSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  clientId: z.string().optional(),
  enabled: z.boolean().default(true),
})

const integrations = ref<Integration[]>([
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: 'Comprehensive mapping and location services',
    icon: siGooglemaps,
    color: '#4285F4',
    status: 'active',
    capabilities: ['routing', 'geocoding', 'place_info', 'imagery'],
    paid: true,
    cloud: true,
    configSchema: googleMapsSchema,
  },
  {
    id: 'pelias',
    name: 'Pelias',
    description: 'Open-source geocoding and search',
    icon: siOpenstreetmap,
    color: '#7EBC6F',
    status: 'active',
    capabilities: ['geocoding'],
    paid: false,
    cloud: false,
    configSchema: hostConfigSchema,
  },
  {
    id: 'graphhopper',
    name: 'GraphHopper',
    description: 'Fast and efficient routing engine',
    icon: siOpenstreetmap,
    color: '#2E7D32',
    status: 'active',
    capabilities: ['routing'],
    paid: false,
    cloud: false,
    configSchema: apiKeySchema,
  },
  {
    id: 'yelp',
    name: 'Yelp',
    description: 'Local business reviews and ratings',
    icon: siYelp,
    color: '#D32323',
    status: 'available',
    capabilities: ['place_info'],
    paid: true,
    cloud: true,
    configSchema: oauthConfigSchema,
  },
  {
    id: 'opentable',
    name: 'OpenTable',
    description: 'Restaurant discovery and reservations',
    icon: null,
    color: '#222222',
    status: 'available',
    capabilities: ['place_info'],
    paid: true,
    cloud: true,
    configSchema: apiKeySchema,
  },
  {
    id: 'foursquare',
    name: 'Foursquare',
    description: 'Location-based social network',
    icon: siFoursquare,
    color: '#F94877',
    status: 'available',
    capabilities: ['place_info'],
    paid: true,
    cloud: true,
    configSchema: oauthConfigSchema,
  },
  {
    id: 'mapillary',
    name: 'Mapillary',
    description: 'Street-level imagery platform',
    icon: siMapillary,
    color: '#2B2B2B',
    status: 'available',
    capabilities: ['imagery'],
    paid: false,
    cloud: true,
    configSchema: apiKeySchema,
  },
  {
    id: 'nominatim',
    name: 'Nominatim',
    description: 'Open-source geocoding and reverse geocoding',
    icon: siOpenstreetmap,
    color: '#7EBC6F',
    status: 'available',
    capabilities: ['geocoding'],
    paid: false,
    cloud: false,
    configSchema: nominatimSchema,
  },
  {
    id: 'tripadvisor',
    name: 'TripAdvisor',
    description: 'Travel reviews and recommendations',
    icon: siTripadvisor,
    color: '#34E0A1',
    status: 'available',
    capabilities: ['place_info'],
    paid: true,
    cloud: true,
    configSchema: apiKeySchema,
  },
  {
    id: 'geoapify',
    name: 'Geoapify',
    description: 'Geocoding, routing, and place data',
    icon: null,
    color: '#FF5A5F',
    status: 'available',
    capabilities: ['geocoding', 'routing', 'place_info'],
    paid: true,
    cloud: true,
    configSchema: apiKeySchema,
  },
])

const configuredIntegrations = computed(() =>
  integrations.value.filter(i => i.status === 'active'),
)

const availableIntegrations = computed(() =>
  integrations.value.filter(i => i.status === 'available'),
)

function getInitial(name: string): string {
  return name[0].toUpperCase()
}

function getStatusColors(status: Integration['status']) {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
    case 'inactive':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
    case 'available':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

async function handleCardClick(integration: Integration) {
  const isConfigured = integration.status === 'active'
  const result = await appService.promptForm({
    schema: integration.configSchema || apiKeySchema,
    title: isConfigured
      ? t('settings.integrations.edit', { name: integration.name })
      : t('settings.integrations.configure', { name: integration.name }),
    description: t(`settings.integrations.descriptions.${integration.id}`),
  })

  if (result) {
    console.log('Integration updated:', result)
    // In a real app, you'd update the integration status and save the config
    if (!isConfigured) {
      // If it was not configured, update its status to active
      integration.status = 'active'
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Configured Integrations -->
    <SettingsSection
      :title="t('settings.integrations.title')"
      :description="t('settings.integrations.description')"
      :frame="false"
      :shadow="false"
    >
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card
          v-for="integration in configuredIntegrations"
          :key="integration.id"
          class="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
          @click="handleCardClick(integration)"
        >
          <div class="flex flex-col gap-3">
            <div class="flex items-start justify-between">
              <div
                class="size-12 flex items-center justify-center rounded-lg"
                :style="{ backgroundColor: integration.color }"
              >
                <svg
                  v-if="integration.icon"
                  class="size-7 text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  v-html="integration.icon.svg"
                />
                <span v-else class="text-white font-medium text-lg">
                  {{ getInitial(integration.name) }}
                </span>
              </div>
              <div class="flex gap-1">
                <span
                  v-if="integration.paid"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-semibold"
                >
                  $
                </span>
                <span
                  v-if="integration.cloud"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-semibold flex items-center gap-0.5"
                >
                  <Cloud class="size-3" />
                </span>
                <span
                  v-if="integration.status"
                  class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase"
                  :class="getStatusColors(integration.status)"
                >
                  {{ t(`settings.integrations.status.${integration.status}`) }}
                </span>
              </div>
            </div>
            <div>
              <h4 class="font-medium">{{ integration.name }}</h4>
              <p class="text-sm text-muted-foreground line-clamp-2">
                {{ t(`settings.integrations.descriptions.${integration.id}`) }}
              </p>
              <div class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="capability in integration.capabilities"
                  :key="capability"
                  class="text-xs px-2 py-0.5 rounded-full bg-primary/5 text-primary font-semibold"
                >
                  {{ t(`settings.integrations.capabilities.${capability}`) }}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </SettingsSection>

    <!-- Available Integrations -->
    <SettingsSection
      :title="t('settings.integrations.available')"
      :frame="false"
      :shadow="false"
    >
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card
          v-for="integration in availableIntegrations"
          :key="integration.id"
          class="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
          @click="handleCardClick(integration)"
        >
          <div class="flex flex-col gap-3">
            <div class="flex items-start justify-between">
              <div
                class="size-12 flex items-center justify-center rounded-lg"
                :style="{ backgroundColor: integration.color }"
              >
                <svg
                  v-if="integration.icon"
                  class="size-7 text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  v-html="integration.icon.svg"
                />
                <span v-else class="text-white font-medium text-lg">
                  {{ getInitial(integration.name) }}
                </span>
              </div>
              <div class="flex gap-1">
                <span
                  v-if="integration.paid"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-semibold"
                >
                  $
                </span>
                <span
                  v-if="integration.cloud"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-semibold flex items-center gap-0.5"
                >
                  <Cloud class="size-3" />
                </span>
                <span
                  v-if="integration.status"
                  class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase"
                  :class="getStatusColors(integration.status)"
                >
                  {{ t(`settings.integrations.status.${integration.status}`) }}
                </span>
              </div>
            </div>
            <div>
              <h4 class="font-medium">{{ integration.name }}</h4>
              <p class="text-sm text-muted-foreground line-clamp-2">
                {{ t(`settings.integrations.descriptions.${integration.id}`) }}
              </p>
              <div class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="capability in integration.capabilities"
                  :key="capability"
                  class="text-xs px-2 py-0.5 rounded-full bg-primary/5 text-primary font-semibold"
                >
                  {{ t(`settings.integrations.capabilities.${capability}`) }}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </SettingsSection>
  </div>
</template>
