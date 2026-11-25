<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStorage } from '@vueuse/core'
import { useIdentityStore } from '@/stores/identity.store'
import RecoveryWordsDialog from './RecoveryWordsDialog.vue'

const { identity, isLoading, isSetupComplete, isStale, hasSavedRecoveryWords } = storeToRefs(useIdentityStore())

/** Asked again each session until the words are confirmed; closing it only skips this one. */
const skippedFor = useSessionStorage('parchment:recovery-words-skipped', '')
const open = ref(false)

watch(
  () =>
    // Waits out loading, which is when a device learns its keys are outdated.
    !isLoading.value && isSetupComplete.value && !isStale.value && hasSavedRecoveryWords.value === false
      ? identity.value?.signingKey
      : null,
  signingKey => {
    if (signingKey && skippedFor.value !== signingKey) open.value = true
  },
  { immediate: true },
)

watch(isStale, stale => {
  if (stale) open.value = false
})

watch(open, isOpen => {
  if (!isOpen && hasSavedRecoveryWords.value === false) skippedFor.value = identity.value?.signingKey ?? ''
})
</script>

<template>
  <RecoveryWordsDialog v-model:open="open" mode="view" />
</template>
