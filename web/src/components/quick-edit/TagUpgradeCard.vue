<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { SparklesIcon } from 'lucide-vue-next'
import BrandLogo from './BrandLogo.vue'
import TagDiff from './TagDiff.vue'
import type { TagUpgrade } from '@/types/quick-edit.types'

defineProps<{
  upgrade: TagUpgrade
}>()

const emit = defineEmits<{
  apply: []
  decline: []
  ignore: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
    <div class="mb-2 flex items-center gap-2.5">
      <BrandLogo
        v-if="upgrade.brand"
        :src="upgrade.brand.logoUrl"
        :name="upgrade.brand.name"
        size="sm"
      />
      <SparklesIcon v-else class="size-4 shrink-0 text-amber-600" />
      <div class="min-w-0">
        <p class="text-sm font-medium">
          {{
            upgrade.brand
              ? t('quickEdit.upgrade.brandTitle', { brand: upgrade.brand.name })
              : t('quickEdit.upgrade.title')
          }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{
            upgrade.brand
              ? t('quickEdit.upgrade.brandHint')
              : t('quickEdit.upgrade.hint')
          }}
        </p>
      </div>
    </div>

    <TagDiff :diff="upgrade.changes" class="mb-2" />

    <div class="flex flex-wrap gap-2">
      <Button size="sm" class="h-7 text-xs" @click="emit('apply')">
        {{ t('quickEdit.upgrade.apply') }}
      </Button>
      <Button
        v-if="upgrade.brand"
        size="sm"
        variant="ghost"
        class="h-7 text-xs"
        @click="emit('decline')"
      >
        {{ t('quickEdit.upgrade.decline', { brand: upgrade.brand.name }) }}
      </Button>
      <Button size="sm" variant="ghost" class="h-7 text-xs" @click="emit('ignore')">
        {{ t('quickEdit.upgrade.ignore') }}
      </Button>
    </div>
  </div>
</template>
