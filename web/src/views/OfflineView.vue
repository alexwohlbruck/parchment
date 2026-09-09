<script setup lang="ts">
/**
 * Shown when a view's chunk couldn't be loaded — offline before it was
 * ever opened, or a stale chunk hash after a deploy. Part of the main
 * bundle (never lazy), or it couldn't render in the very case it exists
 * for.
 *
 * Recovers on its own: retries the intended route as soon as there's a
 * connection again.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { EmptyState } from '@/components/ui/empty-state'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { useConnectivity } from '@/composables/useConnectivity'
import { AppRoute } from '@/router'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { isOffline, onReconnected } = useConnectivity()

const target = computed(() => {
  const from = route.query.from
  return typeof from === 'string' && from.startsWith('/') ? from : '/'
})

function retry() {
  // Online means the chunk itself is stale (a deploy rotated the hashes);
  // only a full load picks up the new index.html and asset names.
  if (isOffline.value) router.replace(target.value)
  else window.location.assign(target.value)
}

onReconnected(() => router.replace(target.value))
</script>

<template>
  <PanelLayout>
    <EmptyState
      :title="t('offline.viewUnavailable.title')"
      :description="t('offline.viewUnavailable.description')"
      :offline="isOffline"
      class="mt-20"
      @retry="retry"
    />
  </PanelLayout>
</template>
