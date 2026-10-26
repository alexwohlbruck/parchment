<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import RecoveryKeyDisplay from './RecoveryKeyDisplay.vue'
import { useIdentityStore } from '@/stores/identity.store'
import type { ConfirmDialogOptions } from '@/types/app.types'

defineProps<ConfirmDialogOptions & { loading?: boolean }>()
const emit = defineEmits<{ submit: [confirmed: boolean] }>()
const identityStore = useIdentityStore()
const recoveryKey = ref<string | null>(null)

onMounted(async () => {
  recoveryKey.value = await identityStore.fetchRecoveryKey()
})
</script>

<template>
  <ConfirmDialog v-bind="$props" @submit="emit('submit', $event)">
    <RecoveryKeyDisplay v-if="recoveryKey" :recovery-key="recoveryKey" />
  </ConfirmDialog>
</template>
