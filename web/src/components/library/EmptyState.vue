<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { PlusIcon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { capitalize } from '@/filters/text.filters'
import { LucideIcon } from 'lucide-vue-next'

interface Props {
  icon: LucideIcon
  collectionId: string
}

const props = defineProps<Props>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center gap-3 mt-32">
    <component :is="icon" class="h-12 w-12 text-muted-foreground" />
    <p class="text-muted-foreground text-sm">
      {{
        capitalize(
          t('library.empty.message', {
            entityPlural: t(`library.entities.${collectionId}.title.plural`),
          }),
        )
      }}
    </p>
    <Button disabled variant="outline" size="sm" class="gap-1.5">
      <PlusIcon class="h-3 w-3" />
      {{
        capitalize(
          t('library.empty.action', {
            entitySingular: t(
              `library.entities.${collectionId}.title.singular`,
            ),
          }),
        )
      }}
    </Button>
  </div>
</template>
