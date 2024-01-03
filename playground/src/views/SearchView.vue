<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import CommandPalette from '../components/organisms/CommandPalette.vue'

const router = useRouter()
const visible = ref(true)
</script>

<template>
  <CommandPalette
    :visible="visible"
    @update:visible="
      (newValue) => {
        visible = newValue
        router.push('/map')
      }
    "
  />
</template>
