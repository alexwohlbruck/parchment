import { computed, watch, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { useBattery, useStorage } from '@vueuse/core'
import type { PowerSaver, PowerSaverAuto } from '@/types/power.types'
import { autoPowerSaver, DEFAULT_POWER_SAVER_AUTO, isStronger, strongerSaver } from '@/lib/power/power-saver'
import { toast } from '@/lib/toast'
import { i18n } from '@/lib/i18n'

export const usePowerStore = defineStore('power', () => {
  const choice = useStorage<PowerSaver>('power-saver', 'off')
  const auto = useStorage<PowerSaverAuto>('power-saver-auto', DEFAULT_POWER_SAVER_AUTO, undefined, {
    mergeDefaults: true,
  })

  const battery = useBattery()
  const batterySupported = battery.isSupported

  const fromBattery = computed(() =>
    autoPowerSaver(
      auto.value,
      batterySupported.value ? { level: battery.level.value, charging: battery.charging.value } : null,
    ),
  )

  const saver = computed(() => strongerSaver(choice.value, fromBattery.value))
  const saving = computed(() => saver.value !== 'off')

  watchEffect(() => document.documentElement.classList.toggle('motion-off', saver.value === 'extreme'))

  // The map changing look on its own needs a reason on screen.
  watch(fromBattery, (next, prev) => {
    if (!isStronger(next, prev) || !isStronger(next, choice.value)) return
    toast((i18n.global as any).t(`powerSaver.autoOn.${next}`, { percent: Math.round(battery.level.value * 100) }), {
      id: 'power-saver-auto',
    })
  })

  return { choice, auto, saver, saving, fromBattery, batterySupported }
})
