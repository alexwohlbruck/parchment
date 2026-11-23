<script setup lang="ts">
import type { WidgetResponse, WidgetDescriptor, TransitStopInfo, Place } from '@/types/place.types'
import { useI18n } from 'vue-i18n'
import PlaceTransit from '@/components/transit/departures/PlaceTransitCard.vue'
import OfflineDataNotice from '@/components/offline/OfflineDataNotice.vue'
import { OFFLINE_SOURCE_ID } from '@/lib/offline/packages'

const props = defineProps<{
  data: WidgetResponse<TransitStopInfo>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const { t } = useI18n()
</script>

<template>
  <OfflineDataNotice v-if="data.data.sourceId === OFFLINE_SOURCE_ID" :text="t('offlineMaps.notice.departures')" class="mb-2" />
  <PlaceTransit
    :place="place"
    :transitInfo="(data.data.value as TransitStopInfo)"
    :widgetParams="(descriptor.params as Record<string, string>)"
  />
</template>
