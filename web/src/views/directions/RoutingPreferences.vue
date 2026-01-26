<script setup lang="ts">
import { computed, watch, ref, onMounted } from 'vue'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  CarFrontIcon,
  BikeIcon,
  TrainIcon,
  FootprintsIcon,
} from 'lucide-vue-next'
import { RoutingPreferences } from '@/types/multimodal.types'

const props = defineProps<{
  modelValue: RoutingPreferences
  selectedMode: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: RoutingPreferences]
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

// Convert safety slider value (0-1) to display percentage
const safetyPercentage = computed(() =>
  Math.round((preferences.value.safetyVsEfficiency ?? 0.5) * 100),
)

// Convert max walking distance from meters to km for display
const maxWalkingKm = computed({
  get: () => (preferences.value.maxWalkingDistance ?? 1000) / 1000,
  set: (value: number) =>
    updatePreference('maxWalkingDistance', Math.round(value * 1000)),
})

// Computed properties for boolean switches with defaults
const useKnownVehicleLocations = computed({
  get: () => preferences.value.useKnownVehicleLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownVehicleLocations', value),
})

const useKnownParkingLocations = computed({
  get: () => preferences.value.useKnownParkingLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownParkingLocations', value),
})

// Map mode types to tab values
const modeToTab: Record<string, string> = {
  pedestrian: 'pedestrian',
  bicycle: 'bicycle',
  transit: 'transit',
  auto: 'auto',
  multi: 'pedestrian', // Default for multi mode
}

// Active tab state
const activeTab = ref<string>('pedestrian')

// Initialize tab based on current mode
onMounted(() => {
  // Always sync to current mode first
  if (props.selectedMode !== 'multi') {
    activeTab.value = modeToTab[props.selectedMode] || 'pedestrian'
  } else {
    // For multi mode, use last opened tab from localStorage
    const saved = localStorage.getItem('routingPreferencesTab')
    activeTab.value = saved || 'pedestrian'
  }
})

// Watch for mode changes and sync tabs
watch(
  () => props.selectedMode,
  (newMode) => {
    // Always sync to current mode
    if (newMode !== 'multi') {
      activeTab.value = modeToTab[newMode] || 'pedestrian'
    } else {
      // For multi mode, use last opened tab from localStorage
      const saved = localStorage.getItem('routingPreferencesTab')
      activeTab.value = saved || 'pedestrian'
    }
  },
  { immediate: false }
)

// Save tab selection for multi mode
function handleTabChange(value: string | number) {
  const tabValue = String(value)
  activeTab.value = tabValue
  if (props.selectedMode === 'multi') {
    localStorage.setItem('routingPreferencesTab', tabValue)
  }
}
</script>

<template>
  <div class="w-full">
    <Tabs :model-value="activeTab" @update:model-value="handleTabChange" class="w-full">
      <TabsList class="w-full grid grid-cols-4">
        <TabsTrigger value="pedestrian" class="text-xs" title="Walking">
          <FootprintsIcon class="size-5" />
        </TabsTrigger>
        <TabsTrigger value="bicycle" class="text-xs" title="Cycling">
          <BikeIcon class="size-5" />
        </TabsTrigger>
        <TabsTrigger value="transit" class="text-xs" title="Transit">
          <TrainIcon class="size-5" />
        </TabsTrigger>
        <TabsTrigger value="auto" class="text-xs" title="Driving">
          <CarFrontIcon class="size-5" />
        </TabsTrigger>
      </TabsList>

      <!-- Walking Options -->
      <TabsContent value="pedestrian" class="p-4 space-y-4 mt-0">
        <div class="space-y-3">
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

        <div class="space-y-3 border-t border-border pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="avoid-hills-walking" class="text-sm font-normal">Hills</Label>
              <Switch
                id="avoid-hills-walking"
                :model-value="preferences.avoidHills ?? false"
                @update:model-value="(val) => updatePreference('avoidHills', val)"
              />
            </div>
            <div class="flex items-center justify-between">
              <Label for="avoid-ferries-walking" class="text-sm font-normal">Ferries</Label>
              <Switch
                id="avoid-ferries-walking"
                :model-value="preferences.avoidFerries ?? false"
                @update:model-value="(val) => updatePreference('avoidFerries', val)"
              />
            </div>
          </div>
        </div>

        <div class="space-y-3 border-t border-border pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Prefer</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="prefer-lit-walking" class="text-sm font-normal">Lit paths</Label>
              <Switch
                id="prefer-lit-walking"
                :model-value="preferences.preferLitPaths ?? false"
                @update:model-value="(val) => updatePreference('preferLitPaths', val)"
              />
            </div>
            <div class="flex items-center justify-between">
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

        <div class="space-y-3 border-t border-border pt-3">
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
      <TabsContent value="bicycle" class="p-4 space-y-4 mt-0">
        <div class="space-y-3">
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

        <div class="space-y-3 border-t border-border pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="avoid-hills-cycling" class="text-sm font-normal">Hills</Label>
              <Switch
                id="avoid-hills-cycling"
                :model-value="preferences.avoidHills ?? false"
                @update:model-value="(val) => updatePreference('avoidHills', val)"
              />
            </div>
            <div class="flex items-center justify-between">
              <Label for="avoid-ferries-cycling" class="text-sm font-normal">Ferries</Label>
              <Switch
                id="avoid-ferries-cycling"
                :model-value="preferences.avoidFerries ?? false"
                @update:model-value="(val) => updatePreference('avoidFerries', val)"
              />
            </div>
          </div>
        </div>

        <div class="space-y-3 border-t border-border pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Prefer</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="prefer-lit-cycling" class="text-sm font-normal">Lit paths</Label>
              <Switch
                id="prefer-lit-cycling"
                :model-value="preferences.preferLitPaths ?? false"
                @update:model-value="(val) => updatePreference('preferLitPaths', val)"
              />
            </div>
            <div class="flex items-center justify-between">
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

        <div class="space-y-3 border-t border-border pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Vehicle Options</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="use-known-bike-locations" class="text-sm font-normal">
                Use known bike locations
              </Label>
              <Switch
                id="use-known-bike-locations"
                v-model="useKnownVehicleLocations"
              />
            </div>
            <div class="flex items-center justify-between">
              <Label for="use-known-bike-parking" class="text-sm font-normal">
                Use known bike parking
              </Label>
              <Switch
                id="use-known-bike-parking"
                v-model="useKnownParkingLocations"
              />
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Transit Options -->
      <TabsContent value="transit" class="p-4 space-y-4 mt-0">
        <div class="space-y-3">
          <Label for="max-walking" class="text-sm font-normal">
            Max walking distance
          </Label>
          <div class="flex items-center gap-2">
            <Input
              id="max-walking"
              v-model.number="maxWalkingKm"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              class="flex-1"
            />
            <span class="text-sm text-muted-foreground">km</span>
          </div>
        </div>

        <div class="space-y-3 border-t border-border pt-3">
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

        <div class="space-y-3 border-t border-border pt-3">
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

        <div class="space-y-3 border-t border-border pt-3">
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
      <TabsContent value="auto" class="p-4 space-y-4 mt-0">
        <div class="space-y-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Avoid</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="avoid-highways" class="text-sm font-normal">Highways</Label>
              <Switch
                id="avoid-highways"
                :model-value="preferences.avoidHighways ?? false"
                @update:model-value="(val) => updatePreference('avoidHighways', val)"
              />
            </div>
            <div class="flex items-center justify-between">
              <Label for="avoid-tolls" class="text-sm font-normal">Tolls</Label>
              <Switch
                id="avoid-tolls"
                :model-value="preferences.avoidTolls ?? false"
                @update:model-value="(val) => updatePreference('avoidTolls', val)"
              />
            </div>
            <div class="flex items-center justify-between">
              <Label for="avoid-ferries-auto" class="text-sm font-normal">Ferries</Label>
              <Switch
                id="avoid-ferries-auto"
                :model-value="preferences.avoidFerries ?? false"
                @update:model-value="(val) => updatePreference('avoidFerries', val)"
              />
            </div>
          </div>
        </div>

        <div class="space-y-3 border-t border-border pt-3">
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

        <div class="space-y-3 border-t border-border pt-3">
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">Vehicle Options</h4>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label for="use-known-car-locations" class="text-sm font-normal">
                Use known car locations
              </Label>
              <Switch
                id="use-known-car-locations"
                v-model="useKnownVehicleLocations"
              />
            </div>
            <div class="flex items-center justify-between">
              <Label for="use-known-parking" class="text-sm font-normal">
                Use known parking locations
              </Label>
              <Switch
                id="use-known-parking"
                v-model="useKnownParkingLocations"
              />
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
