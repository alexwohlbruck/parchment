<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlusIcon, XIcon } from 'lucide-vue-next'

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
  emit('set', key, newValue.value.trim() || '')
  newKey.value = ''
  newValue.value = ''
}
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="(value, key) in props.tags"
      :key="key"
      class="flex items-center gap-1.5"
    >
      <Input
        :model-value="String(key)"
        class="h-8 flex-1 font-mono text-xs"
        @change="emit('rename', String(key), ($event.target as HTMLInputElement).value.trim())"
      />
      <Input
        :model-value="value"
        class="h-8 flex-1 font-mono text-xs"
        @update:model-value="emit('set', String(key), String($event))"
      />
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        @click="emit('set', String(key), null)"
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>

    <div class="flex items-center gap-1.5">
      <Input
        v-model="newKey"
        :placeholder="t('quickEdit.rawKey')"
        class="h-8 flex-1 font-mono text-xs"
        @keydown.enter="addRow"
      />
      <Input
        v-model="newValue"
        :placeholder="t('quickEdit.rawValue')"
        class="h-8 flex-1 font-mono text-xs"
        @keydown.enter="addRow"
      />
      <Button variant="ghost" size="icon" class="size-7 shrink-0" @click="addRow">
        <PlusIcon class="size-3.5" />
      </Button>
    </div>
  </div>
</template>
