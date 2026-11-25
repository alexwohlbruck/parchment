<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { pickCheckPositions, sameRecoveryWord } from '@/lib/identity/recovery-words'

const props = defineProps<{ words: string[] }>()
const passed = defineModel<boolean>('passed', { default: false })

const { t } = useI18n()
const positions = pickCheckPositions()
const typed = ref(positions.map(() => ''))
const matches = computed(() => positions.map((position, i) => sameRecoveryWord(typed.value[i], props.words[position])))

watchEffect(() => {
  passed.value = matches.value.every(Boolean)
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-muted-foreground">{{ t('settings.identity.recoveryKey.check.prompt') }}</p>
    <div class="grid grid-cols-3 gap-2">
      <label v-for="(position, i) in positions" :key="position" class="flex flex-col gap-1.5">
        <span class="flex items-center gap-1 text-xs text-muted-foreground">
          {{ t('settings.identity.recoveryKey.check.wordLabel', { number: position + 1 }) }}
          <Check v-if="matches[i]" class="size-3.5 text-forest-600" aria-hidden="true" />
        </span>
        <Input
          v-model="typed[i]"
          class="font-mono text-sm"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
        />
      </label>
    </div>
  </div>
</template>
