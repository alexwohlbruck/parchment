<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { CarFrontIcon, BikeIcon, TrainIcon, FootprintsIcon, ChevronRightIcon } from 'lucide-vue-next'
import type { SelectedMode } from '@/types/multimodal.types'
import type { ModeKey } from '@/lib/preferences/navigation-preferences'
import { useRoutingPreferenceControls } from '@/composables/directions/useRoutingPreferenceControls'
import RoutingGeneralFields from './RoutingGeneralFields.vue'
import RoutingModeFields from './RoutingModeFields.vue'

const props = withDefaults(defineProps<{ selectedMode?: SelectedMode }>(), {
  selectedMode: 'multi',
})

const { t } = useI18n()

const TABS = [
  { mode: 'walking', icon: FootprintsIcon },
  { mode: 'biking', icon: BikeIcon },
  { mode: 'transit', icon: TrainIcon },
  { mode: 'driving', icon: CarFrontIcon },
] as const satisfies readonly { mode: ModeKey; icon: unknown }[]

const SAVED_TAB_KEY = 'routingPreferencesTab'

const isTab = (mode: string | null): mode is ModeKey => TABS.some(tab => tab.mode === mode)

function initialTab(): ModeKey {
  const preferred = props.selectedMode === 'multi' ? localStorage.getItem(SAVED_TAB_KEY) : props.selectedMode
  return isTab(preferred) ? preferred : 'walking'
}

const activeTab = ref<ModeKey>(initialTab())
watch(() => props.selectedMode, () => (activeTab.value = initialTab()))

function handleTabChange(value: string | number) {
  activeTab.value = String(value) as ModeKey
  if (props.selectedMode === 'multi') localStorage.setItem(SAVED_TAB_KEY, activeTab.value)
}

const { preferences, updatePreference } = useRoutingPreferenceControls(() => activeTab.value, 'compact')

const advancedOpen = ref(false)

const customModelText = computed({
  get: () => preferences.value.customModelOverride ?? '',
  set: (value: string) => updatePreference('customModelOverride', value || undefined),
})

const customModelError = computed(() => {
  const text = customModelText.value.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    return typeof parsed !== 'object' || Array.isArray(parsed) ? t('directions.preferences.customModelObject') : ''
  } catch (e) {
    return (e as Error).message || t('directions.preferences.customModelInvalid')
  }
})
</script>

<template>
  <div class="w-full">
    <div class="px-4 py-3 space-y-3">
      <h2 class="font-semibold">{{ t('directions.preferences.general') }}</h2>
      <RoutingGeneralFields layout="compact" />
    </div>

    <Separator />

    <div class="px-4 pt-3 pb-2">
      <h2 class="font-semibold">{{ t(`directions.preferences.modes.${activeTab}`) }}</h2>
    </div>

    <Tabs :model-value="activeTab" class="w-full px-2" @update:model-value="handleTabChange">
      <TabsList class="w-full grid grid-cols-4">
        <TabsTrigger
          v-for="tab in TABS"
          :key="tab.mode"
          :value="tab.mode"
          class="text-xs"
          :title="t(`directions.preferences.modes.${tab.mode}`)"
        >
          <component :is="tab.icon" class="size-5" />
        </TabsTrigger>
      </TabsList>

      <TabsContent v-for="tab in TABS" :key="tab.mode" :value="tab.mode" class="py-3 px-2 space-y-4 mt-0">
        <RoutingModeFields :mode="tab.mode" layout="compact" />
      </TabsContent>
    </Tabs>

    <Separator />

    <Collapsible v-model:open="advancedOpen" class="px-4 py-3">
      <CollapsibleTrigger class="flex items-center gap-2 w-full -mx-2 px-2 min-h-8 pointer-coarse:min-h-11 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 active:bg-muted transition-colors cursor-pointer select-none">
        <ChevronRightIcon class="size-4 transition-transform duration-200" :class="advancedOpen && 'rotate-90'" />
        {{ t('directions.preferences.advanced') }}
      </CollapsibleTrigger>

      <CollapsibleContent class="pt-3 space-y-2">
        <Label class="text-xs font-normal text-muted-foreground">
          {{ t('directions.preferences.customModel') }}
        </Label>
        <Textarea
          :model-value="customModelText"
          placeholder='{ "priority": [...], "speed": [...] }'
          class="font-mono text-xs min-h-[100px] resize-y"
          :class="customModelError && 'border-destructive'"
          @update:model-value="value => (customModelText = String(value ?? ''))"
        />
        <p v-if="customModelError" class="text-xs text-destructive">{{ customModelError }}</p>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
