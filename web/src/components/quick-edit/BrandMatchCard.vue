<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import BrandLogo from './BrandLogo.vue'
import TagDiff from './TagDiff.vue'
import type { BrandSuggestion } from '@/types/quick-edit.types'

defineProps<{
  suggestion: BrandSuggestion
}>()

const emit = defineEmits<{
  apply: []
  dismiss: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
    <div class="mb-2 flex items-center gap-2.5">
      <BrandLogo
        :src="suggestion.brand.logoUrl"
        :name="suggestion.brand.name"
        size="sm"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">
          {{ t('quickEdit.brand.matchTitle', { brand: suggestion.brand.name }) }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ t('quickEdit.brand.matchHint') }}
        </p>
      </div>
    </div>

    <TagDiff :diff="suggestion.diff" class="mb-2" />

    <div class="flex gap-2">
      <Button size="sm" class="h-7 text-xs" @click="emit('apply')">
        {{ t('quickEdit.brand.apply') }}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 text-xs"
        @click="emit('dismiss')"
      >
        {{ t('quickEdit.brand.dismiss') }}
      </Button>
    </div>
  </div>
</template>
