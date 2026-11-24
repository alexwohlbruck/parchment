<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import RecoveryWordsDisplay from './RecoveryWordsDisplay.vue'
import { useIdentityStore } from '@/stores/identity.store'
import type { ConfirmDialogOptions } from '@/types/app.types'

defineProps<ConfirmDialogOptions & { loading?: boolean }>()
const emit = defineEmits<{ submit: [confirmed: boolean] }>()
const identityStore = useIdentityStore()
const recoveryWords = ref<string[] | null>(null)

onMounted(async () => {
  recoveryWords.value = await identityStore.fetchRecoveryWords()
})
</script>

<template>
  <ConfirmDialog v-bind="$props" @submit="emit('submit', $event)">
    <RecoveryWordsDisplay v-if="recoveryWords" :recovery-words="recoveryWords" />
  </ConfirmDialog>
</template>
