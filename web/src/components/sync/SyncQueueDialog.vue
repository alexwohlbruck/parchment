<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSyncStore } from '@/stores/sync.store'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import SyncQueuePanel from './SyncQueuePanel.vue'

const { t } = useI18n()
const syncStore = useSyncStore()
</script>

<template>
  <ResponsiveDialog
    v-model:open="syncStore.reviewOpen"
    :title="t('offline.sync.title')"
  >
    <template #content>
      <SyncQueuePanel class="w-full" :show-title="false" />
    </template>
  </ResponsiveDialog>
</template>
