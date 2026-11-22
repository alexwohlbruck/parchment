<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { CloudDownloadIcon, PlusIcon } from 'lucide-vue-next'
import DetailPanelLayout from '@/components/sheet/layouts/DetailPanelLayout.vue'
import RegionRow from '@/components/offline/RegionRow.vue'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useOfflineStore } from '@/stores/offline.store'
import { formatBytes } from '@/lib/offline/format'
import { AppRoute } from '@/router'

const { t, locale } = useI18n()
const router = useRouter()
const offlineStore = useOfflineStore()

const storage = computed(() => {
  const saved = offlineStore.regions.reduce((sum, r) => sum + r.bytes, 0)
  const u = offlineStore.usage
  if (!saved || !u?.quota) return null
  return t('offlineMaps.storage', {
    used: formatBytes(saved, locale.value),
    free: formatBytes(Math.max(0, u.quota - u.usage), locale.value),
  })
})

const create = () => router.push({ name: AppRoute.OFFLINE_MAPS_NEW })

onMounted(() => void offlineStore.refreshUsage())
</script>

<template>
  <DetailPanelLayout :title="t('offlineMaps.title')">
    <template v-if="offlineStore.regions.length" #actions>
      <Button variant="outline" size="icon" :aria-label="t('offlineMaps.create')" :title="t('offlineMaps.create')" @click="create">
        <PlusIcon class="size-4" />
      </Button>
    </template>

    <EmptyState
      v-if="!offlineStore.supported"
      :icon="CloudDownloadIcon"
      :title="t('offlineMaps.unsupported')"
      class="mt-16"
    />

    <EmptyState
      v-else-if="!offlineStore.regions.length"
      :icon="CloudDownloadIcon"
      :title="t('offlineMaps.empty.title')"
      :description="t('offlineMaps.empty.description')"
      class="mt-16"
    >
      <Button size="sm" class="gap-1.5" @click="create">
        <PlusIcon class="size-3.5" />
        {{ t('offlineMaps.create') }}
      </Button>
    </EmptyState>

    <div v-else class="flex flex-col gap-2">
      <RegionRow v-for="region in offlineStore.regions" :key="region.id" :region="region" />
    </div>

    <p v-if="storage && offlineStore.regions.length" class="mt-4 px-1 text-xs text-muted-foreground">
      {{ storage }}
    </p>
  </DetailPanelLayout>
</template>
