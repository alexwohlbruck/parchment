<script setup lang="ts">
import { ref } from 'vue'
import H3 from '@/components/ui/typography/H3.vue'
import H6 from '@/components/ui/typography/H6.vue'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ThemeControls from './ThemeControls.vue'

const mapTheme = ref('auto')
</script>

<template>
  <div class="flex flex-col gap-4 w-fit">
    <div>
      <H6>{{ $t('settings.appearance.appTheme.title') }}</H6>
      <ThemeControls class="mt-3" />
    </div>

    <form class="flex flex-col gap-4">
      <FormField name="map-theme">
        <FormItem>
          <FormLabel>{{ $t('settings.appearance.mapTheme.title') }}</FormLabel>

          <Select v-model="mapTheme">
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
            </FormControl>
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
        </FormItem>
      </FormField>
    </form>
  </div>
</template>
