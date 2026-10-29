<!-- Battery run — DEV ONLY, rendered by the Developer settings page. -->

<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'
import { BatteryMediumIcon, CopyIcon, LeafIcon, PlayIcon, SquareIcon } from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClipboard } from '@/composables/useClipboard'
import { usePowerStore } from '@/stores/power.store'
import { formatStopwatch } from '@/lib/time-format'
import type { PowerSaver } from '@/types/power.types'
import { batteryRun, RUN_DURATION_MS, startBatteryRun, stopBatteryRun } from '@/dev/battery/battery-run'
import { batteryReport } from '@/dev/battery/battery-report'

const SAVERS: PowerSaver[] = ['off', 'normal', 'extreme']

const power = usePowerStore()
const { copied, copy } = useClipboard()
const manualStart = ref<number>()
const manualEnd = ref<number>()

const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 1000)
onScopeDispose(() => clearInterval(clock))

const running = computed(() => batteryRun.startedAt != null)
const elapsed = computed(() =>
  batteryRun.startedAt != null ? now.value - batteryRun.startedAt : batteryRun.readings.at(-1)?.t ?? 0,
)
const level = computed(() => batteryRun.readings.at(-1)?.level)

const report = computed(() =>
  batteryRun.readings.length
    ? batteryReport(batteryRun.readings, {
        saver: power.saver,
        device: navigator.userAgent,
        manual: batteryRun.supported ? undefined : { start: manualStart.value ?? null, end: manualEnd.value ?? null },
      })
    : null,
)
</script>

<template>
  <SettingsSection
    id="battery-run"
    :title="$t('settings.developer.batteryRun.title')"
    :description="$t('settings.developer.batteryRun.description')"
  >
    <SettingsItem
      title="Battery saver"
      description="Navigation's side of battery saver: normal caps the frame rate, extreme also turns 3D off."
      :icon="LeafIcon"
    >
      <Select v-model="power.saver">
        <SelectTrigger class="w-fit"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="saver in SAVERS" :key="saver" :value="saver">{{ saver }}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>

    <SettingsItem
      title="Record"
      :description="`${formatStopwatch(elapsed / 1000)} of ${formatStopwatch(RUN_DURATION_MS / 1000)}${level != null ? ` · ${Math.round(level * 100)}%` : ''}`"
      :icon="BatteryMediumIcon"
    >
      <Button v-if="running" size="sm" variant="outline" @click="stopBatteryRun">
        <SquareIcon class="size-4" />
        Stop
      </Button>
      <Button v-else size="sm" @click="startBatteryRun">
        <PlayIcon class="size-4" />
        Start
      </Button>
    </SettingsItem>

    <SettingsItem
      v-if="!batteryRun.supported"
      title="Battery level by hand"
      description="This browser hides the battery level. Note it from the system at the start and end."
      block
    >
      <div class="flex gap-2 w-56">
        <Input v-model.number="manualStart" type="number" placeholder="Start %" />
        <Input v-model.number="manualEnd" type="number" placeholder="End %" />
      </div>
    </SettingsItem>

    <SettingsItem v-if="report" title="Result" :icon="CopyIcon" block>
      <div class="flex flex-col gap-2 w-full">
        <pre class="text-xs whitespace-pre-wrap rounded-md bg-muted p-3">{{ report }}</pre>
        <Button size="sm" variant="outline" class="self-start" @click="copy(report)">
          {{ copied ? 'Copied' : 'Copy' }}
        </Button>
      </div>
    </SettingsItem>
  </SettingsSection>
</template>
