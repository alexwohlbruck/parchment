<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarCheckIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import PlaceSection from './PlaceSection.vue'
import type { Place } from '@/types/place.types'
import { usePlaceBooking } from '@/composables/place/usePlaceBooking'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const { policy, dining, links } = usePlaceBooking(() => props.place)

const title = computed(() =>
  dining.value ? t('place.booking.bookTable') : t('place.booking.book'))
</script>

<template>
  <PlaceSection v-if="links.length && policy">
    <template #main>
      <div class="flex gap-3 items-center">
        <CalendarCheckIcon class="size-4 shrink-0 text-muted-foreground" />
        <div class="flex flex-col min-w-0">
          <span class="font-medium text-sm">{{ title }}</span>
          <span class="text-xs text-muted-foreground">{{ t(`place.booking.policy.${policy}`) }}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 pl-7">
        <Button
          v-for="link in links"
          :key="link.provider"
          as="a"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          variant="outline"
          size="sm"
          class="gap-1.5"
        >
          {{ t(`place.booking.providers.${link.provider}`) }}
          <ExternalLinkIcon class="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </template>
  </PlaceSection>
</template>
