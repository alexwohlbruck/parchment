<script setup lang="ts">
import { computed, watch, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CarFrontIcon,
  BikeIcon,
  TrainIcon,
  FootprintsIcon,
} from 'lucide-vue-next'
import { RoutingPreferences, RoutingEngine, SelectedMode } from '@/types/multimodal.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useDirectionsStore } from '@/stores/directions.store'
import { useUnits } from '@/composables/useUnits'

const { t } = useI18n()
const { isMetric, convert } = useUnits()

const props = defineProps<{
  modelValue: RoutingPreferences
  selectedMode: SelectedMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: RoutingPreferences]
  'close': []
}>()

const preferences = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function updatePreference<K extends keyof RoutingPreferences>(
  key: K,
  value: RoutingPreferences[K],
) {
  preferences.value = {
    ...preferences.value,
    [key]: value,
  }
}

// Routing engines state - get from integrations store
const integrationsStore = useIntegrationsStore()
const directionsStore = useDirectionsStore()

// Get routing engines from configured integrations
const routingEngines = computed(() => {
  const configurations = integrationsStore.integrationConfigurations || []
  return configurations
    .filter((integration) => 
      integration.capabilities.some((cap) => cap.id === 'routing' && cap.active)
    )
    .map((integration) => {
      const routingCap = integration.capabilities.find((cap) => cap.id === 'routing') as any
      return {
        integrationId: integration.integrationId,
        name: (integration as any).name || integration.integrationId, // Use name from API
        metadata: routingCap?.metadata || null,
      }
    })
})

const selectedEngine = computed({
  get: () => preferences.value.routingEngine || null,
  set: (value: string | null) => updatePreference('routingEngine', value || undefined),
})

// Handle engine selection change
function handleEngineChange(value: any) {
  selectedEngine.value = value ? String(value) : null
}

// Set default engine on mount if none selected
onMounted(() => {
  if (!selectedEngine.value && routingEngines.value.length > 0) {
    selectedEngine.value = routingEngines.value[0].integrationId
  }
})

// Get currently selected engine metadata
const currentEngineMetadata = computed(() => {
  if (!selectedEngine.value) return null
  const engine = routingEngines.value.find(e => e.integrationId === selectedEngine.value)
  return engine?.metadata || null
})

// Helper to check if a preference is supported
function isPreferenceSupported(preference: string): boolean {
  if (!currentEngineMetadata.value) return true // Show all if no metadata
  const supported = currentEngineMetadata.value.supportedPreferences as Record<string, boolean>
  return supported[preference] === true // Only show if explicitly true
}

// Computed properties to check if sections have any visible items
const hasWalkingAvoidOptions = computed(() => 
  isPreferenceSupported('avoidHills') || isPreferenceSupported('avoidFerries')
)

const hasWalkingPreferOptions = computed(() => 
  isPreferenceSupported('preferLitPaths') || isPreferenceSupported('preferPavedPaths')
)

const hasCyclingAvoidOptions = computed(() => 
  isPreferenceSupported('avoidHills') || isPreferenceSupported('avoidFerries')
)

const hasCyclingPreferOptions = computed(() => 
  isPreferenceSupported('preferLitPaths') || isPreferenceSupported('preferPavedPaths')
)

const hasDrivingAvoidOptions = computed(() => 
  isPreferenceSupported('avoidHighways') || isPreferenceSupported('avoidTolls') || isPreferenceSupported('avoidFerries')
)

// Convert safety slider value (0-1) to display percentage
const safetyPercentage = computed(() =>
  Math.round((preferences.value.safetyVsEfficiency ?? 0.5) * 100),
)

// Max walking distance in display unit (km or mi); stored as meters
const maxWalkingDisplay = computed({
  get: () => {
    const meters = preferences.value.maxWalkingDistance ?? 1000
    if (isMetric.value) return meters / 1000
    return Number(convert(meters, 'm').to('mi'))
  },
  set: (value: number) => {
    const meters = isMetric.value
      ? Math.round(value * 1000)
      : Math.round(Number(convert(value, 'mi').to('m')))
    updatePreference('maxWalkingDistance', meters)
  },
})
const maxWalkingDisplayMin = computed(() => (isMetric.value ? 0.1 : 0.1))
const maxWalkingDisplayMax = computed(() => (isMetric.value ? 10 : 6.2))
const maxWalkingDisplayUnit = computed(() => (isMetric.value ? 'km' : 'mi'))

// Computed properties for boolean switches with defaults
const useKnownVehicleLocations = computed({
  get: () => preferences.value.useKnownVehicleLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownVehicleLocations', value),
})

const useKnownParkingLocations = computed({
  get: () => preferences.value.useKnownParkingLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownParkingLocations', value),
})

// Get current mode display name
const currentModeName = computed(() => {
  switch (activeTab.value) {
    case 'walking':
      return t('directions.preferences.walking')
    case 'biking':
      return t('directions.preferences.cycling')
    case 'transit':
      return t('directions.preferences.transit')
    case 'driving':
      return t('directions.preferences.driving')
    default:
      return ''
  }
})

// Map mode types to tab values
const modeToTab: Record<string, string> = {
  walking: 'walking',
  biking: 'biking',
  transit: 'transit',
  driving: 'driving',
  multi: 'walking', // Default for multi mode
}

// Active tab state
const activeTab = ref<string>('walking')

// Initialize tab based on current mode
onMounted(() => {
  if (props.selectedMode !== 'multi') {
    activeTab.value = modeToTab[props.selectedMode] || 'walking'
  } else {
    activeTab.value = directionsStore.preferencesTab || 'walking'
  }
})

// Watch for mode changes and sync tabs
watch(
  () => props.selectedMode,
  (newMode) => {
    if (newMode !== 'multi') {
      activeTab.value = modeToTab[newMode] || 'walking'
    } else {
      activeTab.value = directionsStore.preferencesTab || 'walking'
    }
  },
  { immediate: false }
)

// Save tab selection for multi mode
function handleTabChange(value: string | number) {
  const tabValue = String(value)
  activeTab.value = tabValue
  if (props.selectedMode === 'multi') {
    directionsStore.preferencesTab = tabValue
  }
}
</script>

<template>
  <div class="w-full">
    <!-- General Section -->
    <div class="p-4 space-y-3">
      <h2 class="font-semibold">{{ t('directions.preferences.general') }}</h2>
      
      <div v-if="routingEngines.length > 0" class="flex items-center justify-between">
        <Label for="routing-engine-global" class="text-sm font-normal">{{ t('directions.preferences.routingEngine') }}</Label>
        <Select
          :model-value="selectedEngine"
          @update:model-value="handleEngineChange"
        >
          <SelectTrigger id="routing-engine-global" class="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Select engine" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="engine in routingEngines"
              :key="engine.integrationId"
              :value="engine.integrationId"
              class="text-xs"
            >
              {{ engine.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-3 border-border pt-3">
        <div class="flex items-center justify-between">
          <Label for="use-known-vehicle-locations" class="text-sm font-normal">
            {{ t('directions.preferences.useKnownVehicleLocations') }}
          </Label>
          <Switch
            id="use-known-vehicle-locations"
            v-model="useKnownVehicleLocations"
          />
        </div>
        <div class="flex items-center justify-between">
          <Label for="use-known-parking-locations" class="text-sm font-normal">
            {{ t('directions.preferences.useKnownParkingLocations') }}
          </Label>
          <Switch
            id="use-known-parking-locations"
            v-model="useKnownParkingLocations"
          />
        </div>
      </div>
    </div>

    <Separator/>

    <!-- Mode Title -->
    <div class="p-4">
      <h2 class="font-semibold">{{ currentModeName }}</h2>
    </div>

    <Tabs :model-value="activeTab" @update:model-value="handleTabChange" class="w-full px-2">
      <TabsList class="w-full grid grid-cols-4">
        <TabsTrigger value="walking" class="text-xs" title="Walking">
          <FootprintsIcon class="size-5" />
        </TabsTrigger>
        <TabsTrigger value="biking" class="text-xs" title="Cycling">
          <BikeIcon class="size-5" />
        </TabsTrigger>
        <TabsTrigger value="transit" class="text-xs" title="Transit">
          <TrainIcon class="size-5" />
        </TabsTrigger>
        <TabsTrigger value="driving" class="text-xs" title="Driving">
          <CarFrontIcon class="size-5" />
        </TabsTrigger>
      </TabsList>

      <!-- Walking Options -->
      <TabsContent value="walking" class="py-4 px-2 space-y-4 mt-0">
        <div v-if="isPreferenceSupported('safetyVsEfficiency')" class="space-y-3">
          <div class="flex items-center justify-between">
            <Label for="safety-slider-walking" class="text-sm font-normal">
              Route priority
            </Label>
            <span class="text-xs text-muted-foreground">
              {{
                safetyPercentage < 40
                  ? 'Fast'
                  : safetyPercentage > 60
                  ? 'Safe'
                  : 'Balanced'
              }}
            </span>
          </div>
          <Slider
            id="safety-slider-walking"
            :model-value="[preferences.safetyVsEfficiency ?? 0.5]"
            :min="0"
            :max="1"
            :step="0.1"
            @update:model-value="(val) => val && updatePreference('safetyVsEfficiency', val[0])"
          />
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>Fastest</span>
            <span>Safest</span>
          </div>
        </div>

        <div v-if="hasWalkingAvoidOptions" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="space-y-3">
            <div v-if="isPreferenceSupported('avoidHills')" class="flex items-center justify-between">
              <Label for="avoid-hills-walking" class="text-sm font-normal">Hills</Label>
              <Switch
                id="avoid-hills-walking"
                :model-value="preferences.avoidHills ?? false"
                @update:model-value="(val) => updatePreference('avoidHills', val)"
              />
            </div>
            <div v-if="isPreferenceSupported('avoidFerries')" class="flex items-center justify-between">
              <Label for="avoid-ferries-walking" class="text-sm font-normal">Ferries</Label>
              <Switch
                id="avoid-ferries-walking"
                :model-value="preferences.avoidFerries ?? false"
                @update:model-value="(val) => updatePreference('avoidFerries', val)"
              />
            </div>
          </div>
        </div>

        <div v-if="hasWalkingPreferOptions" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Prefer</h4>
          <div class="space-y-3">
            <div v-if="isPreferenceSupported('preferLitPaths')" class="flex items-center justify-between">
              <Label for="prefer-lit-walking" class="text-sm font-normal">Lit paths</Label>
              <Switch
                id="prefer-lit-walking"
                :model-value="preferences.preferLitPaths ?? false"
                @update:model-value="(val) => updatePreference('preferLitPaths', val)"
              />
            </div>
            <div v-if="isPreferenceSupported('preferPavedPaths')" class="flex items-center justify-between">
              <Label for="prefer-paved-walking" class="text-sm font-normal">
                Paved paths
              </Label>
              <Switch
                id="prefer-paved-walking"
                :model-value="preferences.preferPavedPaths ?? false"
                @update:model-value="(val) => updatePreference('preferPavedPaths', val)"
              />
            </div>
          </div>
        </div>

        <div v-if="isPreferenceSupported('wheelchairAccessible')" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">
            Accessibility
          </h4>
          <div class="flex items-center justify-between">
            <Label for="wheelchair-walking" class="text-sm font-normal">
              Wheelchair accessible
            </Label>
            <Switch
              id="wheelchair-walking"
              :model-value="preferences.wheelchairAccessible ?? false"
              @update:model-value="(val) => updatePreference('wheelchairAccessible', val)"
            />
          </div>
        </div>
      </TabsContent>

      <!-- Cycling Options -->
      <TabsContent value="biking" class="py-4 px-2 space-y-4 mt-0">
        <div v-if="isPreferenceSupported('safetyVsEfficiency')" class="space-y-3">
          <div class="flex items-center justify-between">
            <Label for="safety-slider-cycling" class="text-sm font-normal">
              Route priority
            </Label>
            <span class="text-xs text-muted-foreground">
              {{
                safetyPercentage < 40
                  ? 'Fast'
                  : safetyPercentage > 60
                  ? 'Safe'
                  : 'Balanced'
              }}
            </span>
          </div>
          <Slider
            id="safety-slider-cycling"
            :model-value="[preferences.safetyVsEfficiency ?? 0.5]"
            :min="0"
            :max="1"
            :step="0.1"
            @update:model-value="(val) => val && updatePreference('safetyVsEfficiency', val[0])"
          />
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>Fastest</span>
            <span>Safest</span>
          </div>
        </div>

        <div v-if="hasCyclingAvoidOptions" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="space-y-3">
            <div v-if="isPreferenceSupported('avoidHills')" class="flex items-center justify-between">
              <Label for="avoid-hills-cycling" class="text-sm font-normal">Hills</Label>
              <Switch
                id="avoid-hills-cycling"
                :model-value="preferences.avoidHills ?? false"
                @update:model-value="(val) => updatePreference('avoidHills', val)"
              />
            </div>
            <div v-if="isPreferenceSupported('avoidFerries')" class="flex items-center justify-between">
              <Label for="avoid-ferries-cycling" class="text-sm font-normal">Ferries</Label>
              <Switch
                id="avoid-ferries-cycling"
                :model-value="preferences.avoidFerries ?? false"
                @update:model-value="(val) => updatePreference('avoidFerries', val)"
              />
            </div>
          </div>
        </div>

        <div v-if="hasCyclingPreferOptions" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Prefer</h4>
          <div class="space-y-3">
            <div v-if="isPreferenceSupported('preferLitPaths')" class="flex items-center justify-between">
              <Label for="prefer-lit-cycling" class="text-sm font-normal">Lit paths</Label>
              <Switch
                id="prefer-lit-cycling"
                :model-value="preferences.preferLitPaths ?? false"
                @update:model-value="(val) => updatePreference('preferLitPaths', val)"
              />
            </div>
            <div v-if="isPreferenceSupported('preferPavedPaths')" class="flex items-center justify-between">
              <Label for="prefer-paved-cycling" class="text-sm font-normal">
                Paved paths
              </Label>
              <Switch
                id="prefer-paved-cycling"
                :model-value="preferences.preferPavedPaths ?? false"
                @update:model-value="(val) => updatePreference('preferPavedPaths', val)"
              />
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Transit Options -->
      <TabsContent value="transit" class="py-4 px-2 space-y-4 mt-0">
        <div v-if="isPreferenceSupported('maxWalkDistance')" class="space-y-3">
          <Label for="max-walking" class="text-sm font-normal">
            Max walking distance
          </Label>
          <div class="flex items-center gap-2">
            <Input
              id="max-walking"
              v-model.number="maxWalkingDisplay"
              type="number"
              :min="maxWalkingDisplayMin"
              :max="maxWalkingDisplayMax"
              step="0.1"
              class="flex-1"
            />
            <span class="text-sm text-muted-foreground">{{ maxWalkingDisplayUnit }}</span>
          </div>
        </div>

        <div v-if="isPreferenceSupported('maxTransfers')" class="space-y-3 pt-3">
          <Label for="max-transfers" class="text-sm font-normal">Max transfers</Label>
          <Input
            id="max-transfers"
            :model-value="preferences.maxTransfers ?? 3"
            type="number"
            min="0"
            max="10"
            step="1"
            @update:model-value="(val) => updatePreference('maxTransfers', Number(val))"
          />
        </div>

        <div v-if="isPreferenceSupported('avoidFerries')" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="flex items-center justify-between">
            <Label for="avoid-ferries-transit" class="text-sm font-normal">Ferries</Label>
            <Switch
              id="avoid-ferries-transit"
              :model-value="preferences.avoidFerries ?? false"
              @update:model-value="(val) => updatePreference('avoidFerries', val)"
            />
          </div>
        </div>

        <div v-if="isPreferenceSupported('wheelchairAccessible')" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">
            Accessibility
          </h4>
          <div class="flex items-center justify-between">
            <Label for="wheelchair-transit" class="text-sm font-normal">
              Wheelchair accessible
            </Label>
            <Switch
              id="wheelchair-transit"
              :model-value="preferences.wheelchairAccessible ?? false"
              @update:model-value="(val) => updatePreference('wheelchairAccessible', val)"
            />
          </div>
        </div>
      </TabsContent>

      <!-- Driving Options -->
      <TabsContent value="driving" class="py-4 px-2 space-y-4 mt-0">
        <div v-if="hasDrivingAvoidOptions" class="space-y-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="space-y-3">
            <div v-if="isPreferenceSupported('avoidHighways')" class="flex items-center justify-between">
              <Label for="avoid-highways" class="text-sm font-normal">Highways</Label>
              <Switch
                id="avoid-highways"
                :model-value="preferences.avoidHighways ?? false"
                @update:model-value="(val) => updatePreference('avoidHighways', val)"
              />
            </div>
            <div v-if="isPreferenceSupported('avoidTolls')" class="flex items-center justify-between">
              <Label for="avoid-tolls" class="text-sm font-normal">Tolls</Label>
              <Switch
                id="avoid-tolls"
                :model-value="preferences.avoidTolls ?? false"
                @update:model-value="(val) => updatePreference('avoidTolls', val)"
              />
            </div>
            <div v-if="isPreferenceSupported('avoidFerries')" class="flex items-center justify-between">
              <Label for="avoid-ferries-auto" class="text-sm font-normal">Ferries</Label>
              <Switch
                id="avoid-ferries-auto"
                :model-value="preferences.avoidFerries ?? false"
                @update:model-value="(val) => updatePreference('avoidFerries', val)"
              />
            </div>
          </div>
        </div>

        <div v-if="isPreferenceSupported('preferHOV')" class="space-y-3 pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Prefer</h4>
          <div class="flex items-center justify-between">
            <Label for="prefer-hov" class="text-sm font-normal">HOV lanes</Label>
            <Switch
              id="prefer-hov"
              :model-value="preferences.preferHOV ?? false"
              @update:model-value="(val) => updatePreference('preferHOV', val)"
            />
          </div>
        </div>
      </TabsContent>
    </Tabs>

    <div class="hidden md:flex justify-end px-4 py-3 border-t border-border">
      <Button size="sm" @click="emit('close')">
        {{ t('general.done') }}
      </Button>
    </div>
  </div>
</template>
