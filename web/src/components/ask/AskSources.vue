<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GlobeIcon } from 'lucide-vue-next'
import { siteName } from '@/lib/ask/site-name'
import type { AskSource } from '@/types/ask.types'

defineProps<{ sources: AskSource[] }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-[12.5px] text-muted-foreground">{{ t('ask.sources') }}</span>
    <div class="flex flex-wrap gap-1.5">
      <a
        v-for="source in sources"
        :key="source.url"
        :href="source.url"
        :title="source.title"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 py-0.5 pl-1.5 pr-2.5 text-xs text-foreground hover:bg-muted transition-colors"
      >
        <GlobeIcon class="size-3 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ siteName(source.url) }}</span>
      </a>
    </div>
  </div>
</template>
