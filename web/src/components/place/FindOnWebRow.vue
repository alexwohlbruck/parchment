<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GlobeIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useAskService } from '@/services/ask/ask.service'
import { isAskOffered } from '@/lib/ask/ask-access'

defineProps<{ query: string }>()

const { t } = useI18n()
const askService = useAskService()

const offered = ref(false)

onMounted(async () => {
  offered.value = isAskOffered(await askService.loadAccess().catch(() => null))
})
</script>

<template>
  <RouterLink
    v-if="offered && query.trim()"
    :to="{ name: AppRoute.ASK, query: { q: t('place.unmapped.askQuestion', { query: query.trim() }) } }"
    class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted"
  >
    <GlobeIcon class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0">
      <span class="block truncate text-sm font-medium">{{ t('place.unmapped.findOnWeb', { query }) }}</span>
      <span class="block text-xs text-muted-foreground">{{ t('place.unmapped.findOnWebHint') }}</span>
    </span>
  </RouterLink>
</template>
