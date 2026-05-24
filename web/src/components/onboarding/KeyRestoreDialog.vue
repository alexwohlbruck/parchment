<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import RecoveryKeyDialog from '@/components/friends/RecoveryKeyDialog.vue'

const SESSION_KEY = 'parchment:key-restore-dismissed'

const identityStore = useIdentityStore()
const { needsImport } = storeToRefs(identityStore)

const dismissed = ref(sessionStorage.getItem(SESSION_KEY) === '1')
const open = ref(false)

onMounted(async () => {
  if (dismissed.value) return
  await identityStore.initialize()
  if (needsImport.value) {
    open.value = true
  }
})

function handleClose(value: boolean) {
  open.value = value
  if (!value) {
    dismissed.value = true
    sessionStorage.setItem(SESSION_KEY, '1')
  }
}

function handleComplete() {
  open.value = false
  dismissed.value = true
  sessionStorage.setItem(SESSION_KEY, '1')
}
</script>

<template>
  <RecoveryKeyDialog
    :open="open"
    mode="import"
    @update:open="handleClose"
    @complete="handleComplete"
  />
</template>
