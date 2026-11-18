import { computed, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { useBattery, useStorage } from '@vueuse/core'
import type { PowerSaver, PowerSaverAuto } from '@/types/power.types'
import { autoPowerSaver, DEFAULT_POWER_SAVER_AUTO, strongerSaver } from '@/lib/power/power-saver'

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

  return { choice, auto, saver, saving, fromBattery, batterySupported }
})
