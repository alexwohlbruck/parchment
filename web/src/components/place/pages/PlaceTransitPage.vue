<script setup lang="ts">
/**
 * Full-screen transit departures sub-page for the place sheet. The grouped
 * departure board lives in TransitDepartureBoard (shared with the routed
 * transit stop/station detail view); this page adds the sheet header.
 */
import { useI18n } from 'vue-i18n'
import type { TransitStopInfo } from '@/types/place.types'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import TransitDepartureBoard from '@/components/transit/TransitDepartureBoard.vue'

defineProps<{
  transitInfo: TransitStopInfo
}>()

const { t } = useI18n()
</script>

<template>
  <PanelLayout>
    <SheetPageHeader :title="transitInfo?.name || t('place.transit.transitStop')" />
    <TransitDepartureBoard :transit-info="transitInfo" />
  </PanelLayout>
</template>
