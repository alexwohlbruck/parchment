<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { PlusIcon, type LucideIcon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { capitalize } from '@/filters/text.filters'
import { EmptyState as BaseEmptyState } from '@/components/ui/empty-state'

/**
 * The library's flavour of `EmptyState`: the wording and the Add action are
 * derived from the entity id, so a tab only has to name what it lists.
 */
defineProps<{
  icon: LucideIcon
  entityId: string
}>()

const { t } = useI18n()
</script>

<template>
  <BaseEmptyState
    :icon="icon"
    :title="
      capitalize(
        t('library.empty.message', {
          entityPlural: t(`library.entities.${entityId}.title.plural`),
        }),
      )
    "
    class="mt-24"
  >
    <Button disabled variant="outline" size="sm" class="gap-1.5">
      <PlusIcon class="h-3 w-3" />
      {{
        capitalize(
          t('library.empty.action', {
            entitySingular: t(`library.entities.${entityId}.title.singular`),
          }),
        )
      }}
    </Button>
  </BaseEmptyState>
</template>
