<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LockIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RecoveryKeyDialog from '@/components/identity/RecoveryKeyDialog.vue'

const emit = defineEmits<{
  (e: 'unlocked'): void
}>()

const { t } = useI18n()
const unlocking = ref(false)
</script>

<template>
  <div class="flex flex-col items-center text-center gap-3 px-6 py-8">
    <div class="rounded-full bg-muted p-3 text-muted-foreground">
      <LockIcon class="size-5" />
    </div>
    <div class="space-y-1 max-w-xs">
      <p class="text-sm font-medium">
        {{ t('library.entities.collections.lockedNotice.title') }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{ t('library.entities.collections.lockedNotice.description') }}
      </p>
    </div>
    <Button variant="outline" size="sm" @click="unlocking = true">
      {{ t('library.entities.collections.lockedNotice.unlock') }}
    </Button>

    <RecoveryKeyDialog
      v-model:open="unlocking"
      mode="import"
      @complete="emit('unlocked')"
    />
  </div>
</template>
