<script lang="ts" setup>
import { useAttrs } from "vue";
import { Label } from "radix-vue";
import { useFormField } from "./useFormField";
import { cn } from "@/lib/utils";

defineOptions({
  inheritAttrs: false,
});
// const props = defineProps<LabelProps>()

const { error, formItemId } = useFormField();
const { class: className, ...rest } = useAttrs();
</script>

<template>
  <Label
    :class="
      cn(
        'block text-sm tracking-tight font-medium text-zinc-950 text-left dark:text-zinc-50',
        error && 'text-red-500 dark:text-red-900',
        className ?? ''
      )
    "
    :for="formItemId"
    v-bind="rest"
  >
    <slot />
  </Label>
</template>
