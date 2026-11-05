<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AccessibilityIcon,
  ArrowRightLeftIcon,
  BikeIcon,
  CircleDollarSignIcon,
  FootprintsIcon,
  GaugeIcon,
  LightbulbIcon,
  MountainIcon,
  RouteIcon,
  ShieldIcon,
  SplineIcon,
  TimerIcon,
  UsersIcon,
} from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useUnits } from '@/composables/useUnits'
import {
  useRoutingPreferenceControls,
  type PreferenceLayout,
} from '@/composables/directions/useRoutingPreferenceControls'
import { DEFAULT_TRANSIT_BUFFER_MINUTES, type ModeKey } from '@/lib/preferences/navigation-preferences'
import PreferenceField from './PreferenceField.vue'
import PreferenceRow from './PreferenceRow.vue'
import PreferenceToggle from './PreferenceToggle.vue'
import PreferenceValueSlider from './PreferenceValueSlider.vue'

const props = defineProps<{ mode: ModeKey; layout: PreferenceLayout }>()

const { t } = useI18n()
const { isMetric, convert } = useUnits()
const { preferences, updatePreference, isSupported } = useRoutingPreferenceControls(
  () => props.mode,
  props.layout,
)

const compact = computed(() => props.layout === 'compact')
const field = (key: string) => t(`directions.preferences.fields.${key}`)

const KPH_TO_MPH = 0.621371
const speedUnit = computed(() => (isMetric.value ? 'kph' : 'mph'))

const cyclingSpeed = computed({
  get: () => {
    const kph = preferences.value.cyclingSpeed ?? 18
    return isMetric.value ? kph : Math.round(kph * KPH_TO_MPH)
  },
  set: (value: number) =>
    updatePreference('cyclingSpeed', isMetric.value ? value : Math.round(value / KPH_TO_MPH)),
})

const walkingSpeed = computed({
  get: () => {
    const kph = preferences.value.walkingSpeed ?? 5.1
    return isMetric.value ? kph : Math.round(kph * KPH_TO_MPH * 10) / 10
  },
  set: (value: number) =>
    updatePreference('walkingSpeed', isMetric.value ? value : Math.round((value / KPH_TO_MPH) * 10) / 10),
})

const distanceUnit = computed(() => (isMetric.value ? 'km' : 'mi'))
const maxWalking = computed({
  get: () => {
    const meters = preferences.value.maxWalkingDistance ?? 1000
    return isMetric.value
      ? Math.round(meters / 100) / 10
      : Math.round(Number(convert(meters, 'm').to('mi')) * 10) / 10
  },
  set: (value: number) =>
    updatePreference(
      'maxWalkingDistance',
      isMetric.value ? Math.round(value * 1000) : Math.round(Number(convert(value, 'mi').to('m'))),
    ),
})

const buffer = computed(() => preferences.value.transitBufferMinutes ?? DEFAULT_TRANSIT_BUFFER_MINUTES)
const bufferHint = computed(() =>
  buffer.value === 0 ? field('cutItFine') : t('directions.preferences.fields.minutes', { count: buffer.value }),
)

const BICYCLE_TYPES = ['Road', 'City', 'Mountain'] as const
</script>

<template>
  <template v-if="mode === 'walking'">
    <PreferenceRow
      pref="hills"
      :label="field('hills')"
      :toggle-label="field('avoidHills')"
      :icon="MountainIcon"
      :on="0"
      :off="0.5"
      toggle-when="below"
    />
    <PreferenceRow
      pref="litPaths"
      :label="field('litPaths')"
      :toggle-label="field('preferLitPaths')"
      :icon="LightbulbIcon"
      :on="1"
      :off="0"
      :fallback="0"
    />
    <PreferenceValueSlider
      v-model="walkingSpeed"
      pref="walkingSpeed"
      :label="field('walkingSpeed')"
      :icon="GaugeIcon"
      :hint="`${walkingSpeed} ${speedUnit}`"
      :min="0.5"
      :max="isMetric ? 10 : 6"
      :step="0.5"
    />
    <PreferenceToggle pref="wheelchairAccessible" :label="field('wheelchair')" :icon="AccessibilityIcon" />
  </template>

  <template v-else-if="mode === 'biking'">
    <PreferenceField v-if="isSupported('bicycleType')" :label="field('bicycleType')" :icon="BikeIcon">
      <Select
        :model-value="preferences.bicycleType || 'City'"
        @update:model-value="value => updatePreference('bicycleType', value as string)"
      >
        <SelectTrigger :class="compact ? 'h-8 w-[120px] text-xs' : 'w-fit'">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="type in BICYCLE_TYPES" :key="type" :value="type" :class="compact ? 'text-xs' : undefined">
            {{ $t(`directions.preferences.fields.bicycleTypes.${type}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </PreferenceField>
    <PreferenceRow
      pref="safetyVsSpeed"
      :label="field('safetyVsSpeed')"
      :icon="ShieldIcon"
      :end-labels="[field('safest'), field('fastest')]"
    />
    <PreferenceRow
      pref="hills"
      :label="field('hills')"
      :toggle-label="field('avoidHills')"
      :icon="MountainIcon"
      :on="0"
      :off="0.5"
      toggle-when="below"
    />
    <PreferenceRow
      pref="surfaceQuality"
      :label="field('surfaceQuality')"
      :toggle-label="field('preferPaved')"
      :icon="SplineIcon"
      :on="1"
      :off="0.25"
      :fallback="0.25"
    />
    <PreferenceValueSlider
      v-model="cyclingSpeed"
      pref="cyclingSpeed"
      :label="field('cyclingSpeed')"
      :icon="GaugeIcon"
      :hint="`${cyclingSpeed} ${speedUnit}`"
      :min="isMetric ? 10 : 5"
      :max="isMetric ? 35 : 22"
    />
  </template>

  <template v-else-if="mode === 'transit'">
    <PreferenceValueSlider
      v-model="maxWalking"
      pref="maxWalkDistance"
      :label="field('maxWalking')"
      :icon="FootprintsIcon"
      :hint="`${maxWalking} ${distanceUnit}`"
      :min="0.1"
      :max="isMetric ? 10 : 6.2"
      :step="0.1"
    />
    <PreferenceField v-if="isSupported('maxTransfers')" :label="field('maxTransfers')" :icon="ArrowRightLeftIcon">
      <Input
        :model-value="preferences.maxTransfers ?? 3"
        type="number"
        min="0"
        max="10"
        step="1"
        :class="compact ? 'h-8 w-20 text-xs' : 'w-20'"
        @update:model-value="value => updatePreference('maxTransfers', Number(value))"
      />
    </PreferenceField>
    <PreferenceField
      :label="field('arriveEarly')"
      :description="field('arriveEarlyDescription')"
      :icon="TimerIcon"
      :hint="bufferHint"
      slider
    >
      <Slider
        :model-value="[buffer]"
        :min="0"
        :max="5"
        :step="1"
        @update:model-value="value => value && updatePreference('transitBufferMinutes', value[0])"
      />
    </PreferenceField>
    <PreferenceToggle pref="wheelchairAccessible" :label="field('wheelchair')" :icon="AccessibilityIcon" />
  </template>

  <template v-else>
    <PreferenceRow
      pref="highways"
      :label="field('highways')"
      :toggle-label="field('avoidHighways')"
      :icon="RouteIcon"
      :on="0"
      :off="0.5"
      toggle-when="below"
    />
    <PreferenceRow
      pref="tolls"
      :label="field('tolls')"
      :toggle-label="field('avoidTolls')"
      :icon="CircleDollarSignIcon"
      :on="0"
      :off="0.5"
      toggle-when="below"
    />
    <PreferenceToggle pref="preferHOV" :label="field('hov')" :icon="UsersIcon" />
  </template>
</template>
