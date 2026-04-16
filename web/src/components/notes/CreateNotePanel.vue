<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MessageSquareIcon, SendIcon } from 'lucide-vue-next'

const props = defineProps<{
  lat: number
  lng: number
  isSubmitting: boolean
}>()

const emit = defineEmits<{
  submit: [text: string]
}>()

const { t } = useI18n()

const text = ref('')
</script>

<template>
  <PanelLayout>
    <!-- Header -->
    <div class="flex items-start gap-2 mb-4">
      <div class="flex items-center gap-2 min-w-0">
        <div
          class="size-8 rounded-full flex items-center justify-center shrink-0"
          :style="{ backgroundColor: 'hsl(var(--primary))' }"
        >
          <MessageSquareIcon class="size-4 text-white" />
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-semibold leading-tight">
            {{ t('notes.createNote') }}
          </h2>
          <span class="text-xs text-muted-foreground">
            {{ lat.toFixed(5) }}, {{ lng.toFixed(5) }}
          </span>
        </div>
      </div>
    </div>

    <p class="text-sm text-muted-foreground mb-3">
      {{ t('notes.createDescription') }}
    </p>

    <!-- Note text input -->
    <div class="space-y-3 mt-auto">
      <Textarea
        v-model="text"
        :placeholder="t('notes.createPlaceholder')"
        :rows="4"
        class="resize-none"
      />
      <Button
        type="button"
        :icon="SendIcon"
        :loading="isSubmitting"
        :disabled="!text.trim() || isSubmitting"
        class="w-full"
        @click="emit('submit', text.trim())"
      >
        {{ t('notes.submitNote') }}
      </Button>
    </div>
  </PanelLayout>
</template>
