<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { HelpCircleIcon } from 'lucide-vue-next'
import { useExternalLink } from '@/composables/useExternalLink'

const props = defineProps<{
  url: string | null
  /** What the link documents, for the tooltip and screen readers. */
  label: string
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()
</script>

<template>
  <button
    v-if="url"
    type="button"
    class="text-muted-foreground/60 transition-colors hover:text-foreground"
    :title="t('quickEdit.wikiLink', { label })"
    :aria-label="t('quickEdit.wikiLink', { label })"
    @click.stop="openExternalLink(props.url!, '_blank')"
  >
    <HelpCircleIcon class="size-3" />
  </button>
</template>
