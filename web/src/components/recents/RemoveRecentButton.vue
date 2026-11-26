<script setup lang="ts">
import { XIcon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRecentsStore } from '@/stores/recents.store'

const props = defineProps<{ identity: string }>()
const emit = defineEmits<{ removed: [] }>()

const { t } = useI18n()
const recentsStore = useRecentsStore()

function remove() {
  recentsStore.forget(props.identity)
  emit('removed')
}
</script>

<template>
  <button
    type="button"
    class="shrink-0 grid place-items-center size-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    :aria-label="t('recents.remove')"
    :title="t('recents.remove')"
    @pointerdown.stop
    @mousedown.stop.prevent
    @click.stop.prevent="remove"
  >
    <XIcon class="size-4" />
  </button>
</template>
