import { inject, provide, type ComputedRef } from 'vue'
import type { RoutingPreferences } from '@/types/multimodal.types'

/**
 * Everything a preference control needs from the panel that owns it.
 *
 * Provided rather than passed as props: each control would otherwise need five
 * identical props threaded through it, which is most of what made the original
 * markup so repetitive. The panel owns the merged read view and the
 * general-vs-per-mode write routing; controls just name a preference key.
 */
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
}

const KEY = Symbol('routing-preferences') as unknown as string

export function providePreferences(context: PreferencesContext) {
  provide(KEY, context)
}

export function usePreferences(): PreferencesContext {
  const context = inject<PreferencesContext>(KEY)
  if (!context) {
    throw new Error('Preference controls must be used inside RoutingPreferences')
  }
  return context
}
