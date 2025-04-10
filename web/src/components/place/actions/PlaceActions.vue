<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { NavigationIcon, ShareIcon } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'directions'): void
  (e: 'share'): void
}>()
</script>

<template>
  <div class="flex gap-2">
    <Button class="flex-1" @click="$emit('directions')">
      <NavigationIcon class="mr-2 h-4 w-4" />
      Directions
    </Button>
    <Button variant="outline" class="flex-1" @click="$emit('share')">
      <ShareIcon class="mr-2 h-4 w-4" />
      Share
    </Button>
  </div>
</template>
