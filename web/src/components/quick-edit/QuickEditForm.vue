<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDownIcon, SendIcon, FlaskConicalIcon } from 'lucide-vue-next'
import TagFieldRow from './TagFieldRow.vue'
import RawTagEditor from './RawTagEditor.vue'
import type { EditablePreset } from '@/types/quick-edit.types'

const props = defineProps<{
  preset: EditablePreset | null
  tags: Record<string, string>
  submitting: boolean
  submitLabel: string
  /** Set when edits go to a non-production OSM server. */
  sandboxServer?: string | null
}>()

const emit = defineEmits<{
  set: [key: string, value: string | null]
  submit: [comment: string]
}>()

const { t } = useI18n()

const comment = ref('')
const rawOpen = ref(false)

/** moreFields can re-reference the same definition; one row per field id. */
const fields = computed(() => {
  const seen = new Set<string>()
  return (props.preset?.fields ?? []).filter((field) => {
    if (seen.has(field.id)) return false
    seen.add(field.id)
    return true
  })
})

const canSubmit = computed(
  () => Object.keys(props.tags).length > 0 && !props.submitting,
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-3">
      <TagFieldRow
        v-for="field in fields"
        :key="field.id"
        :field="field"
        :tags="tags"
        @set="(key, value) => emit('set', key, value)"
      />
    </div>

    <Collapsible v-model:open="rawOpen">
      <CollapsibleTrigger as-child>
        <button
          type="button"
          class="flex w-full items-center justify-between py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {{ t('quickEdit.allTags', Object.keys(tags).length) }}
          <ChevronDownIcon
            class="size-4 transition-transform"
            :class="{ 'rotate-180': rawOpen }"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent class="pt-2">
        <RawTagEditor
          :tags="tags"
          @set="(key, value) => emit('set', key, value)"
          @rename="
            (oldKey, newKey) => {
              if (!newKey || newKey === oldKey) return
              const value = tags[oldKey]
              emit('set', oldKey, null)
              emit('set', newKey, value)
            }
          "
        />
      </CollapsibleContent>
    </Collapsible>

    <div class="space-y-1">
      <Label class="text-xs text-muted-foreground">
        {{ t('quickEdit.changesetComment') }}
      </Label>
      <Input v-model="comment" :placeholder="t('quickEdit.commentPlaceholder')" />
    </div>

    <div
      v-if="sandboxServer"
      class="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
    >
      <FlaskConicalIcon class="size-3.5 shrink-0" />
      {{ t('quickEdit.sandboxNotice', { server: sandboxServer }) }}
    </div>

    <Button
      :icon="SendIcon"
      :loading="submitting"
      :disabled="!canSubmit"
      class="w-full"
      @click="emit('submit', comment.trim())"
    >
      {{ submitLabel }}
    </Button>
  </div>
</template>
