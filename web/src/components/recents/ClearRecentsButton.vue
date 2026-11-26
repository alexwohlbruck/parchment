<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRecentsStore } from '@/stores/recents.store'
import { toast } from '@/lib/toast'

const { t } = useI18n()
const recentsStore = useRecentsStore()
const clearing = ref(false)

async function clear() {
  clearing.value = true
  try {
    await recentsStore.clearAll()
  } catch (error) {
    toast.error(t('recents.clearFailed'), { cause: error })
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
    :disabled="clearing"
    @pointerdown.stop
    @mousedown.prevent
    @click.stop="clear"
  >
    {{ t('recents.clear') }}
  </button>
</template>
