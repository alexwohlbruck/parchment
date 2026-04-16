<script setup lang="ts">
import { computed, watch, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
  AccessibilityIcon,
  CarFrontIcon,
  BikeIcon,
  TrainIcon,
  FootprintsIcon,
  ChevronRightIcon,
} from 'lucide-vue-next'
import type {
  RoutingPreferences,
  PreferenceSupportLevel,
  SelectedMode,
} from '@/types/multimodal.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import {
  useDirectionsStore,
  GENERAL_KEY_SET,
  type ModeKey,
} from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import { useUnits } from '@/composables/useUnits'

const { t } = useI18n()
const { isMetric, convert } = useUnits()

const props = defineProps<{
  selectedMode: SelectedMode
}>()

const emit = defineEmits<{
  close: []
}>()

// Preferences are stored as a split structure: general (shared across modes)
// + per-mode slices. The active tab determines which slice gets written to
// when the user adjusts a mode-specific preference.
const directionsStore = useDirectionsStore()
const { generalPreferences, modePreferences } = storeToRefs(directionsStore)

/**
 * Merged read view for the current tab: general prefs overlaid with the
 * active mode's slice. This preserves the existing template bindings that
 * read `preferences.<key>`.
 */
const preferences = computed<Partial<RoutingPreferences>>(() => {
  const mode = activeTab.value as ModeKey
  return {
    ...generalPreferences.value,
    ...(modePreferences.value[mode] || {}),
  }
})

function updatePreference<K extends keyof RoutingPreferences>(
  key: K,
  value: RoutingPreferences[K],
) {
  if (GENERAL_KEY_SET.has(key as string)) {
    directionsStore.setGeneralPreference(key, value)
  } else {
    directionsStore.setModePreference(activeTab.value as ModeKey, key, value)
  }
}

// ── Routing engines ──────────────────────────────────────────────
const integrationsStore = useIntegrationsStore()

const routingEngines = computed(() => {
  const configurations = integrationsStore.integrationConfigurations || []
  return configurations
    .filter(integration =>
      integration.capabilities.some(cap => cap.id === 'routing' && cap.active),
    )
    .map(integration => {
      const routingCap = integration.capabilities.find(
        cap => cap.id === 'routing',
      ) as any
      return {
        integrationId: integration.integrationId,
        name: (integration as any).name || integration.integrationId,
        metadata: routingCap?.metadata || null,
      }
    })
})

const selectedEngine = computed({
  get: () => preferences.value.routingEngine || null,
  set: (value: string | null) =>
    updatePreference('routingEngine', value || undefined),
})

function handleEngineChange(value: any) {
  selectedEngine.value = value ? String(value) : null
}

onMounted(() => {
  if (!selectedEngine.value && routingEngines.value.length > 0) {
    selectedEngine.value = routingEngines.value[0].integrationId
  }
})

const currentEngineMetadata = computed(() => {
  if (!selectedEngine.value) return null
  const engine = routingEngines.value.find(
    e => e.integrationId === selectedEngine.value,
  )
  return engine?.metadata || null
})

// ── Preference support helpers ───────────────────────────────────

/** Returns the support level for a preference: 'range', 'boolean', or false */
function getPreferenceSupport(preference: string): PreferenceSupportLevel {
  if (!currentEngineMetadata.value) return 'range' // Default to range if no metadata
  const supported = currentEngineMetadata.value.supportedPreferences as Record<
    string,
    PreferenceSupportLevel
  >
  return supported[preference] ?? false
}

function isSupported(preference: string): boolean {
  return getPreferenceSupport(preference) !== false
}

function isRange(preference: string): boolean {
  return getPreferenceSupport(preference) === 'range'
}

// ── 5-stop slider hint labels ────────────────────────────────────

type StopLabels = [string, string, string, string, string]

const stopLabels: Record<string, StopLabels> = {
  safetyVsSpeed: ['Safest', 'Safer', 'Balanced', 'Faster', 'Fastest'],
  hills: ['Avoid', 'Prefer flat', 'Neutral', 'Some OK', "Don't mind hills"],
  ferries: ['Avoid', 'Prefer not', 'Neutral', 'OK', 'Prefer'],
  surfaceQuality: [
    'Any surface',
    'Mostly paved',
    'Balanced',
    'Prefer paved',
    'Paved only',
  ],
  litPaths: ['No preference', 'Slight', 'Moderate', 'Strong', 'Lit only'],
  highways: ['Avoid', 'Prefer not', 'Neutral', 'OK', 'Prefer'],
  tolls: ['Avoid', 'Prefer not', 'Neutral', 'OK', 'Prefer'],
}

function getHintLabel(key: string, value: number): string {
  const labels = stopLabels[key]
  if (!labels) return ''
  // Map 0-1 to index 0-4
  const index = Math.round(value * 4)
  return labels[Math.min(index, 4)]
}

// ── Speed display conversion (kph ↔ mph) ────────────────────────
const KPH_TO_MPH = 0.621371
const MPH_TO_KPH = 1.60934
const speedUnit = computed(() => (isMetric.value ? 'kph' : 'mph'))

// Cycling speed: internal is kph
const cyclingSpeedDisplay = computed({
  get: () => {
    const kph = preferences.value.cyclingSpeed ?? 18
    if (isMetric.value) return kph
    return Math.round(kph * KPH_TO_MPH)
  },
  set: (value: number) => {
    const kph = isMetric.value ? value : Math.round(value * MPH_TO_KPH)
    updatePreference('cyclingSpeed', kph)
  },
})
const cyclingSpeedMin = computed(() => (isMetric.value ? 10 : 5))
const cyclingSpeedMax = computed(() => (isMetric.value ? 35 : 22))

// Walking speed: internal is kph
const walkingSpeedDisplay = computed({
  get: () => {
    const kph = preferences.value.walkingSpeed ?? 5.1
    if (isMetric.value) return kph
    return Math.round(kph * KPH_TO_MPH * 10) / 10
  },
  set: (value: number) => {
    const kph = isMetric.value
      ? value
      : Math.round(value * MPH_TO_KPH * 10) / 10
    updatePreference('walkingSpeed', kph)
  },
})
const walkingSpeedMin = computed(() => (isMetric.value ? 0.5 : 0.5))
const walkingSpeedMax = computed(() => (isMetric.value ? 10 : 6))

// ── Max walking distance conversion ──────────────────────────────
const maxWalkingDisplay = computed({
  get: () => {
    const meters = preferences.value.maxWalkingDistance ?? 1000
    if (isMetric.value) return Math.round(meters / 100) / 10
    return Math.round(Number(convert(meters, 'm').to('mi')) * 10) / 10
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

// ── UI state toggles ─────────────────────────────────────────────
const useKnownVehicleLocations = computed({
  get: () => preferences.value.useKnownVehicleLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownVehicleLocations', value),
})

const useKnownParkingLocations = computed({
  get: () => preferences.value.useKnownParkingLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownParkingLocations', value),
})

// ── Mode title ───────────────────────────────────────────────────
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
    case 'wheelchair':
      return t('directions.preferences.wheelchair', 'Wheelchair')
    default:
      return ''
  }
})

// ── Tab management ───────────────────────────────────────────────
const modeToTab: Record<string, string> = {
  walking: 'walking',
  biking: 'biking',
  transit: 'transit',
  driving: 'driving',
  wheelchair: 'wheelchair',
  multi: 'walking',
}

const activeTab = ref<string>('walking')

onMounted(() => {
  if (props.selectedMode !== 'multi') {
    activeTab.value = modeToTab[props.selectedMode] || 'walking'
  } else {
    const saved = localStorage.getItem('routingPreferencesTab')
    activeTab.value = saved || 'walking'
  }
})

watch(
  () => props.selectedMode,
  newMode => {
    if (newMode !== 'multi') {
      activeTab.value = modeToTab[newMode] || 'walking'
    } else {
      const saved = localStorage.getItem('routingPreferencesTab')
      activeTab.value = saved || 'walking'
    }
  },
  { immediate: false },
)

function handleTabChange(value: string | number) {
  const tabValue = String(value)
  activeTab.value = tabValue
  if (props.selectedMode === 'multi') {
    localStorage.setItem('routingPreferencesTab', tabValue)
  }
}

// ── Advanced: custom_model override ─────────────────────────────
const advancedOpen = ref(false)

const customModelText = computed({
  get: () => preferences.value.customModelOverride ?? '',
  set: (value: string) => {
    updatePreference('customModelOverride', value || undefined)
  },
})

const customModelError = computed(() => {
  const text = customModelText.value.trim()
  if (!text) return '' // empty is valid (means auto-generate)
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'Must be a JSON object'
    }
    return ''
  } catch (e: any) {
    return e.message || 'Invalid JSON'
  }
})
</script>

<template>
  <div class="w-full">
    <!-- General Section -->
    <div class="p-4 space-y-3">
      <h2 class="font-semibold">{{ t('directions.preferences.general') }}</h2>

      <div
        v-if="routingEngines.length > 0"
        class="flex items-center justify-between"
      >
        <Label for="routing-engine-global" class="text-sm font-normal">{{
          t('directions.preferences.routingEngine')
        }}</Label>
        <Select
          :model-value="selectedEngine"
          @update:model-value="handleEngineChange"
        >
          <SelectTrigger
            id="routing-engine-global"
            class="h-8 w-[140px] text-xs"
          >
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

      <!-- Ferries (applies to all modes) -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <Label class="text-sm font-normal">Ferries</Label>
          <span class="text-xs text-muted-foreground">{{
            getHintLabel('ferries', preferences.ferries ?? 0.5)
          }}</span>
        </div>
        <Slider
          :model-value="[preferences.ferries ?? 0.5]"
          :min="0"
          :max="1"
          :step="0.01"
          @update:model-value="
            val => val && updatePreference('ferries', val[0])
          "
        />
      </div>
    </div>

    <Separator />

    <!-- Mode Title -->
    <div class="p-4">
      <h2 class="font-semibold">{{ currentModeName }}</h2>
    </div>

    <Tabs
      :model-value="activeTab"
      @update:model-value="handleTabChange"
      class="w-full px-2"
    >
      <TabsList class="w-full grid grid-cols-5">
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
        <TabsTrigger value="wheelchair" class="text-xs" title="Wheelchair">
          <AccessibilityIcon class="size-5" />
        </TabsTrigger>
      </TabsList>

      <!-- ═══════════════════ Walking ═══════════════════ -->
      <TabsContent value="walking" class="py-4 px-2 space-y-5 mt-0">
        <!-- Hills -->
        <div v-if="isSupported('hills')">
          <template v-if="isRange('hills')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Hills</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('hills', preferences.hills ?? 0.5)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.hills ?? 0.5]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('hills', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Avoid hills</Label>
            <Switch
              :model-value="(preferences.hills ?? 0.5) < 0.5"
              @update:model-value="
                val => updatePreference('hills', val ? 0 : 0.5)
              "
            />
          </div>
        </div>

        <!-- Lit Paths -->
        <div v-if="isSupported('litPaths')">
          <template v-if="isRange('litPaths')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Lit paths</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('litPaths', preferences.litPaths ?? 0)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.litPaths ?? 0]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('litPaths', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Prefer lit paths</Label>
            <Switch
              :model-value="(preferences.litPaths ?? 0) > 0.5"
              @update:model-value="
                val => updatePreference('litPaths', val ? 1 : 0)
              "
            />
          </div>
        </div>

        <!-- Walking Speed -->
        <div v-if="isSupported('walkingSpeed')" class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-sm font-normal">Walking speed</Label>
            <span class="text-xs text-muted-foreground"
              >{{ walkingSpeedDisplay }} {{ speedUnit }}</span
            >
          </div>
          <Slider
            :model-value="[walkingSpeedDisplay]"
            :min="walkingSpeedMin"
            :max="walkingSpeedMax"
            :step="0.5"
            @update:model-value="val => val && (walkingSpeedDisplay = val[0])"
          />
        </div>

        <!-- Wheelchair -->
        <div
          v-if="isSupported('wheelchairAccessible')"
          class="flex items-center justify-between"
        >
          <Label class="text-sm font-normal">Wheelchair accessible</Label>
          <Switch
            :model-value="preferences.wheelchairAccessible ?? false"
            @update:model-value="
              val => updatePreference('wheelchairAccessible', val)
            "
          />
        </div>
      </TabsContent>

      <!-- ═══════════════════ Cycling ═══════════════════ -->
      <TabsContent value="biking" class="py-4 px-2 space-y-5 mt-0">
        <!-- Bicycle Type -->
        <div
          v-if="isSupported('bicycleType')"
          class="flex items-center justify-between"
        >
          <Label class="text-sm font-normal">Bicycle type</Label>
          <Select
            :model-value="preferences.bicycleType || 'City'"
            @update:model-value="
              val => updatePreference('bicycleType', val as string)
            "
          >
            <SelectTrigger class="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Road" class="text-xs">Road</SelectItem>
              <SelectItem value="City" class="text-xs">City</SelectItem>
              <SelectItem value="Mountain" class="text-xs">Mountain</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Safety vs Speed -->
        <div v-if="isSupported('safetyVsSpeed')">
          <template v-if="isRange('safetyVsSpeed')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Route priority</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('safetyVsSpeed', preferences.safetyVsSpeed ?? 0.5)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.safetyVsSpeed ?? 0.5]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('safetyVsSpeed', val[0])
              "
            />
            <div
              class="flex justify-between text-xs text-muted-foreground mt-1"
            >
              <span>Safest</span>
              <span>Fastest</span>
            </div>
          </template>
        </div>

        <!-- Hills -->
        <div v-if="isSupported('hills')">
          <template v-if="isRange('hills')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Hills</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('hills', preferences.hills ?? 0.5)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.hills ?? 0.5]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('hills', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Avoid hills</Label>
            <Switch
              :model-value="(preferences.hills ?? 0.5) < 0.5"
              @update:model-value="
                val => updatePreference('hills', val ? 0 : 0.5)
              "
            />
          </div>
        </div>

        <!-- Surface Quality -->
        <div v-if="isSupported('surfaceQuality')">
          <template v-if="isRange('surfaceQuality')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Surface quality</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel(
                  'surfaceQuality',
                  preferences.surfaceQuality ?? 0.25,
                )
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.surfaceQuality ?? 0.25]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('surfaceQuality', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Prefer paved paths</Label>
            <Switch
              :model-value="(preferences.surfaceQuality ?? 0.25) > 0.5"
              @update:model-value="
                val => updatePreference('surfaceQuality', val ? 1 : 0.25)
              "
            />
          </div>
        </div>

        <!-- Cycling Speed -->
        <div v-if="isSupported('cyclingSpeed')" class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-sm font-normal">Average cycling speed</Label>
            <span class="text-xs text-muted-foreground"
              >{{ cyclingSpeedDisplay }} {{ speedUnit }}</span
            >
          </div>
          <Slider
            :model-value="[cyclingSpeedDisplay]"
            :min="cyclingSpeedMin"
            :max="cyclingSpeedMax"
            :step="1"
            @update:model-value="val => val && (cyclingSpeedDisplay = val[0])"
          />
        </div>
      </TabsContent>

      <!-- ═══════════════════ Transit ═══════════════════ -->
      <TabsContent value="transit" class="py-4 px-2 space-y-5 mt-0">
        <div v-if="isSupported('maxWalkDistance')" class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-sm font-normal">Max walking distance</Label>
            <span class="text-xs text-muted-foreground"
              >{{ maxWalkingDisplay }} {{ maxWalkingDisplayUnit }}</span
            >
          </div>
          <Slider
            :model-value="[maxWalkingDisplay]"
            :min="maxWalkingDisplayMin"
            :max="maxWalkingDisplayMax"
            :step="0.1"
            @update:model-value="val => val && (maxWalkingDisplay = val[0])"
          />
        </div>

        <div v-if="isSupported('maxTransfers')" class="space-y-3">
          <Label for="max-transfers" class="text-sm font-normal"
            >Max transfers</Label
          >
          <Input
            id="max-transfers"
            :model-value="preferences.maxTransfers ?? 3"
            type="number"
            min="0"
            max="10"
            step="1"
            @update:model-value="
              val => updatePreference('maxTransfers', Number(val))
            "
          />
        </div>

        <div
          v-if="isSupported('wheelchairAccessible')"
          class="flex items-center justify-between"
        >
          <Label class="text-sm font-normal">Wheelchair accessible</Label>
          <Switch
            :model-value="preferences.wheelchairAccessible ?? false"
            @update:model-value="
              val => updatePreference('wheelchairAccessible', val)
            "
          />
        </div>
      </TabsContent>

      <!-- ═══════════════════ Driving ═══════════════════ -->
      <TabsContent value="driving" class="py-4 px-2 space-y-5 mt-0">
        <!-- Highways -->
        <div v-if="isSupported('highways')">
          <template v-if="isRange('highways')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Highways</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('highways', preferences.highways ?? 0.5)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.highways ?? 0.5]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('highways', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Avoid highways</Label>
            <Switch
              :model-value="(preferences.highways ?? 0.5) < 0.5"
              @update:model-value="
                val => updatePreference('highways', val ? 0 : 0.5)
              "
            />
          </div>
        </div>

        <!-- Tolls -->
        <div v-if="isSupported('tolls')">
          <template v-if="isRange('tolls')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Tolls</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('tolls', preferences.tolls ?? 0.5)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.tolls ?? 0.5]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('tolls', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Avoid tolls</Label>
            <Switch
              :model-value="(preferences.tolls ?? 0.5) < 0.5"
              @update:model-value="
                val => updatePreference('tolls', val ? 0 : 0.5)
              "
            />
          </div>
        </div>

        <!-- HOV -->
        <div
          v-if="isSupported('preferHOV')"
          class="flex items-center justify-between"
        >
          <Label class="text-sm font-normal">Prefer HOV lanes</Label>
          <Switch
            :model-value="preferences.preferHOV ?? false"
            @update:model-value="val => updatePreference('preferHOV', val)"
          />
        </div>
      </TabsContent>

      <!-- ═══════════════════ Wheelchair ═══════════════════ -->
      <TabsContent value="wheelchair" class="py-4 px-2 space-y-5 mt-0">
        <!-- Hills -->
        <div v-if="isSupported('hills')">
          <template v-if="isRange('hills')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Hills</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel('hills', preferences.hills ?? 0.5)
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.hills ?? 0.5]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('hills', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Avoid hills</Label>
            <Switch
              :model-value="(preferences.hills ?? 0.5) < 0.5"
              @update:model-value="
                val => updatePreference('hills', val ? 0 : 0.5)
              "
            />
          </div>
        </div>

        <!-- Surface Quality -->
        <div v-if="isSupported('surfaceQuality')">
          <template v-if="isRange('surfaceQuality')">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-normal">Surface quality</Label>
              <span class="text-xs text-muted-foreground">{{
                getHintLabel(
                  'surfaceQuality',
                  preferences.surfaceQuality ?? 0.25,
                )
              }}</span>
            </div>
            <Slider
              :model-value="[preferences.surfaceQuality ?? 0.25]"
              :min="0"
              :max="1"
              :step="0.01"
              @update:model-value="
                val => val && updatePreference('surfaceQuality', val[0])
              "
            />
          </template>
          <div v-else class="flex items-center justify-between">
            <Label class="text-sm font-normal">Prefer paved paths</Label>
            <Switch
              :model-value="(preferences.surfaceQuality ?? 0.25) > 0.5"
              @update:model-value="
                val => updatePreference('surfaceQuality', val ? 1 : 0.25)
              "
            />
          </div>
        </div>

        <!-- Walking Speed -->
        <div v-if="isSupported('walkingSpeed')" class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-sm font-normal">Speed</Label>
            <span class="text-xs text-muted-foreground"
              >{{ walkingSpeedDisplay }} {{ speedUnit }}</span
            >
          </div>
          <Slider
            :model-value="[walkingSpeedDisplay]"
            :min="walkingSpeedMin"
            :max="walkingSpeedMax"
            :step="0.5"
            @update:model-value="val => val && (walkingSpeedDisplay = val[0])"
          />
        </div>
      </TabsContent>
    </Tabs>

    <!-- ═══════════════════ Advanced: Custom Model ═══════════════════ -->
    <Separator />

    <Collapsible v-model:open="advancedOpen" class="px-4 py-3">
      <CollapsibleTrigger class="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ChevronRightIcon
          class="size-4 transition-transform duration-200"
          :class="advancedOpen && 'rotate-90'"
        />
        Advanced
      </CollapsibleTrigger>

      <CollapsibleContent class="pt-3 space-y-2">
        <Label class="text-xs font-normal text-muted-foreground">
          Custom model JSON override. Leave empty to auto-generate from
          preferences above.
        </Label>
        <Textarea
          :model-value="customModelText"
          @update:model-value="val => (customModelText = String(val ?? ''))"
          placeholder='{ "priority": [...], "speed": [...] }'
          class="font-mono text-xs min-h-[100px] resize-y"
          :class="customModelError && customModelText.trim() && 'border-destructive'"
        />
        <p
          v-if="customModelError && customModelText.trim()"
          class="text-xs text-destructive"
        >
          {{ customModelError }}
        </p>
      </CollapsibleContent>
    </Collapsible>

    <div class="hidden md:flex justify-end px-4 py-3 border-t border-border">
      <Button size="sm" @click="emit('close')">
        {{ t('general.done') }}
      </Button>
    </div>
  </div>
</template>
