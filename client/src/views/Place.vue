<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'

const count = ref(0)
</script>

<template>
  <div
    class="p-4 bg-background max-h-full overflow-y-auto m-2 py-2 shadow-md flex flex-col gap-2 rounded-md"
  >
    Place
    <Button @click="count++">Increment</Button>
    {{ count }}
  </div>
</template>
