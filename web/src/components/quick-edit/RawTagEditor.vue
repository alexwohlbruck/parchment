<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { PlusIcon, XIcon } from 'lucide-vue-next'
import TagSuggestInput from './TagSuggestInput.vue'
import WikiLink from './WikiLink.vue'
import { osmWikiUrl } from '@/lib/quick-edit/osm-wiki'

const props = defineProps<{
  tags: Record<string, string>
}>()

const emit = defineEmits<{
  set: [key: string, value: string | null]
  rename: [oldKey: string, newKey: string]
}>()

const { t } = useI18n()

const newKey = ref('')
const newValue = ref('')

function addRow() {
  const key = newKey.value.trim()
  if (!key) return
  emit('set', key, newValue.value.trim())
  newKey.value = ''
  newValue.value = ''
}
</script>

<template>
  <div class="space-y-1">
    <div
      v-for="(value, key) in props.tags"
      :key="key"
      class="flex items-center gap-1"
    >
      <TagSuggestInput
        :model-value="String(key)"
        class="flex-1"
        @commit="emit('rename', String(key), $event.trim())"
      />
      <span class="text-xs text-muted-foreground">=</span>
      <TagSuggestInput
        :model-value="value"
        :for-key="String(key)"
        class="flex-1"
        @commit="emit('set', String(key), $event)"
      />
      <WikiLink :url="osmWikiUrl(String(key), value)" :label="String(key)" />
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0 text-muted-foreground"
        @click="emit('set', String(key), null)"
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>

    <div class="flex items-center gap-1 pt-1">
      <TagSuggestInput
        :model-value="newKey"
        :placeholder="t('quickEdit.rawKey')"
        class="flex-1"
        @commit="newKey = $event"
      />
      <span class="text-xs text-muted-foreground">=</span>
      <TagSuggestInput
        :model-value="newValue"
        :for-key="newKey"
        :placeholder="t('quickEdit.rawValue')"
        class="flex-1"
        @commit="newValue = $event"
      />
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0 text-muted-foreground"
        :disabled="!newKey.trim()"
        @click="addRow"
      >
        <PlusIcon class="size-3.5" />
      </Button>
    </div>
  </div>
</template>
