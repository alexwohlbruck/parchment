<script lang="ts" setup>
import SvgIcon from "@jamescoyle/vue-icon";

export interface Props {
  path: any;
  size?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: "6",
});
</script>

<template>
  <SvgIcon type="mdi" :path="path" :class="`size-${size}`"></SvgIcon>
</template>
