<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, XIcon } from 'lucide-vue-next'
import { useIdentityStore } from '@/stores/identity.store'
import RecoveryWordsDialog from './RecoveryWordsDialog.vue'

withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

const { t } = useI18n()
const identityStore = useIdentityStore()
const open = ref(false)

watch(open, isOpen => {
  if (!isOpen && !identityStore.hasSavedRecoveryWords) identityStore.snoozeRecoveryWordsReminder()
})
</script>

<template>
  <template v-if="identityStore.isRecoveryWordsReminderDue || open">
    <button
      v-if="collapsed"
      type="button"
      class="flex h-10 w-full cursor-pointer items-center rounded-md px-2 text-foreground transition-colors hover:bg-foreground/5"
      :aria-label="t('settings.identity.recoveryKey.hint.title')"
      :title="t('settings.identity.recoveryKey.hint.title')"
      @click="open = true"
    >
      <span class="relative inline-flex">
        <KeyRound class="size-5 text-muted-foreground" />
        <span class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-muted" aria-hidden />
      </span>
    </button>

    <div
      v-else
      class="flex h-9 w-full items-center rounded-md border border-border/60 bg-muted/40 transition-colors hover:bg-muted/70"
    >
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pl-2.5 text-left"
        @click="open = true"
      >
        <KeyRound class="size-4 shrink-0 text-primary" />
        <span class="min-w-0 flex-1 truncate text-sm text-foreground">
          {{ t('settings.identity.recoveryKey.hint.title') }}
        </span>
      </button>
      <button
        type="button"
        class="flex size-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
        :aria-label="t('settings.identity.recoveryKey.hint.later')"
        :title="t('settings.identity.recoveryKey.hint.later')"
        @click="identityStore.snoozeRecoveryWordsReminder()"
      >
        <XIcon class="size-4" />
      </button>
    </div>

    <RecoveryWordsDialog v-model:open="open" mode="view" />
  </template>
</template>
