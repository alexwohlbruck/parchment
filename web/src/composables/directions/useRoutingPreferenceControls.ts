import { computed, inject, onMounted, provide, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PreferenceSupportLevel, RoutingPreferences } from '@/types/multimodal.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { GENERAL_KEY_SET, type ModeKey } from '@/lib/preferences/navigation-preferences'

/** `compact` stacks sliders under their label for the planner popover; `settings` renders settings rows. */
export type PreferenceLayout = 'compact' | 'settings'

/** What a preference control reads from the panel that owns it, so it only names a key. */
export interface PreferencesContext {
  preferences: ComputedRef<Partial<RoutingPreferences>>
  updatePreference: <K extends keyof RoutingPreferences>(
    key: K,
    value: RoutingPreferences[K],
  ) => void
  /** False when the active routing engine has no support for the preference. */
  isSupported: (preference: string) => boolean
  /** True when the engine takes a 0–1 weight rather than an on/off flag. */
  isRange: (preference: string) => boolean
  /** Wording for the current slider position, e.g. "Prefer flat". */
  getHintLabel: (key: string, value: number) => string
  layout: PreferenceLayout
}

const KEY = Symbol('routing-preferences') as unknown as string

export function providePreferences(context: PreferencesContext) {
  provide(KEY, context)
}

export function usePreferences(): PreferencesContext {
  const context = inject<PreferencesContext>(KEY)
  if (!context) {
    throw new Error('Preference controls must be used under useRoutingPreferenceControls')
  }
  return context
}

const HINT_STOPS = 5

interface RoutingEngine {
  integrationId: string
  name: string
  metadata: { supportedPreferences?: Record<string, PreferenceSupportLevel> } | null
}

/**
 * Routing preferences for one mode, merged over the general ones, with writes
 * routed back to the right slice. Provides the context the preference controls read.
 */
export function useRoutingPreferenceControls(mode: () => ModeKey, layout: PreferenceLayout) {
  const { t, te } = useI18n()
  const navigationPreferences = useNavigationPreferencesStore()
  const integrationsStore = useIntegrationsStore()

  const preferences = computed<Partial<RoutingPreferences>>(() => ({
    ...navigationPreferences.routing.general,
    ...navigationPreferences.routing.mode[mode()],
  }))

  function updatePreference<K extends keyof RoutingPreferences>(key: K, value: RoutingPreferences[K]) {
    if (GENERAL_KEY_SET.has(key as string)) navigationPreferences.setGeneralPreference(key, value)
    else navigationPreferences.setModePreference(mode(), key, value)
  }

  const routingEngines = computed<RoutingEngine[]>(() =>
    (integrationsStore.integrationConfigurations || []).flatMap(integration => {
      const routing = integration.capabilities.find(cap => cap.id === 'routing' && cap.active) as
        | { metadata?: RoutingEngine['metadata'] }
        | undefined
      if (!routing) return []
      return [
        {
          integrationId: integration.integrationId,
          name: (integration as { name?: string }).name || integration.integrationId,
          metadata: routing.metadata ?? null,
        },
      ]
    }),
  )

  const selectedEngine = computed({
    get: () => preferences.value.routingEngine || null,
    set: (value: string | null) => updatePreference('routingEngine', value || undefined),
  })

  onMounted(() => {
    if (!selectedEngine.value && routingEngines.value.length > 0) {
      selectedEngine.value = routingEngines.value[0].integrationId
    }
  })

  function support(preference: string): PreferenceSupportLevel {
    const engine = routingEngines.value.find(e => e.integrationId === selectedEngine.value)
    const supported = engine?.metadata?.supportedPreferences
    if (!supported) return 'range'
    return supported[preference] ?? false
  }

  const isSupported = (preference: string) => support(preference) !== false
  const isRange = (preference: string) => support(preference) === 'range'

  function getHintLabel(key: string, value: number): string {
    const index = Math.min(Math.round(value * (HINT_STOPS - 1)), HINT_STOPS - 1)
    const path = `directions.preferences.hints.${key}.${index}`
    return te(path) ? t(path) : ''
  }

  providePreferences({ preferences, updatePreference, isSupported, isRange, getHintLabel, layout })

  return { preferences, updatePreference, routingEngines, selectedEngine, isSupported }
}
