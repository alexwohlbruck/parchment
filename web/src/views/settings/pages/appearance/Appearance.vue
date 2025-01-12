<script setup lang="ts">
import { ref } from 'vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Span } from '@/components/ui/typography'
import { Slider } from '@/components/ui/slider'
import ThemeControls from './ThemeControls.vue'
import { SettingsSection, SettingsItem } from '@/components/settings'

const mapTheme = ref('auto')
const color = ref<string>('blue')
const radius = ref<number[]>([0.5])
const darkTheme = ref('auto')
</script>

<template>
  <div class="flex flex-col gap-4 w-fit">
    <SettingsSection :title="$t('settings.appearance.appTheme.title')">
      <ThemeControls class="mt-3" />
    </SettingsSection>

    <!-- <SettingsSection :title="$t('settings.appearance.appTheme.title')">
      <SettingsItem title="Theme color">
        <Select v-model="color">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="blue">
              <div class="flex items-center gap-2">
                <div class="w-2.5 h-2.5 bg-blue-500 rounded-full"></div>
                <Span>Blue</Span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem title="Theme radius">
        <div class="flex items-center gap-2">
          <Span class="text-sm text-muted-foreground font-medium">
            {{ radius[0] }}
          </Span>
          <Slider
            v-model="radius"
            class="w-48"
            :default-value="[0.5]"
            :max="1"
            :step="0.25"
          />
        </div>
      </SettingsItem>

      <SettingsItem title="Dark theme">
        <Select v-model="darkTheme">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection> -->

    <SettingsSection :title="$t('settings.appearance.mapTheme.title')">
      <SettingsItem :title="$t('settings.appearance.mapTheme.title')">
        <Select v-model="mapTheme">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="auto">
                {{ $t('settings.appearance.mapTheme.values.matchTime') }}
              </SelectItem>
              <SelectItem value="match">{{
                $t('settings.appearance.mapTheme.values.match')
              }}</SelectItem>
              <SelectItem value="light">{{
                $t('settings.appearance.mapTheme.values.day')
              }}</SelectItem>
              <SelectItem value="dark">{{
                $t('settings.appearance.mapTheme.values.night')
              }}</SelectItem>
              <SelectItem value="dawn">{{
                $t('settings.appearance.mapTheme.values.dawn')
              }}</SelectItem>
              <SelectItem value="dusk">{{
                $t('settings.appearance.mapTheme.values.dusk')
              }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>
  </div>
</template>
