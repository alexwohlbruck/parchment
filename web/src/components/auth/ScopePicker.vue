<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Checkbox } from '@/components/ui/checkbox'
import type { TokenScope } from '@/types/access-token.types'

const props = defineProps<{ scopes: readonly TokenScope[] }>()
const selected = defineModel<TokenScope[]>({ required: true })

const { t } = useI18n()

function toggle(scope: TokenScope, on: boolean) {
  selected.value = on
    ? props.scopes.filter(candidate => candidate === scope || selected.value.includes(candidate))
    : selected.value.filter(candidate => candidate !== scope)
}
</script>

<template>
  <div class="flex flex-col divide-y rounded-lg border">
    <label
      v-for="scope in scopes"
      :key="scope"
      class="flex items-start gap-3 px-3 py-2.5 cursor-pointer"
    >
      <Checkbox
        class="mt-0.5"
        :model-value="selected.includes(scope)"
        @update:model-value="toggle(scope, $event === true)"
      />
      <span class="flex flex-col">
        <span class="text-sm font-medium leading-5">{{ t(`settings.auth.scopes.${scope}.title`) }}</span>
        <span class="text-xs text-muted-foreground">{{ t(`settings.auth.scopes.${scope}.description`) }}</span>
      </span>
    </label>
  </div>
</template>
