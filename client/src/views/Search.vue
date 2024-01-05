<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import Palette from "../components/Palette.vue";

const router = useRouter();
const open = ref(true);
</script>

<template>
  <Palette
    :open="open"
    @update:open="
      (newValue) => {
        open = newValue;
        // router.push('/map');
      }
    "
  />
</template>
