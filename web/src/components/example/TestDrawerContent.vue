<script setup lang="ts">
interface Props {
  title?: string
  message?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Test Drawer',
  message: 'This is a test drawer opened programmatically!'
})
</script>

<template>
  <div class="p-6">
    <h2 class="text-xl font-semibold mb-4">{{ title }}</h2>
    <p class="text-muted-foreground mb-4">{{ message }}</p>
    <div class="space-y-4">
      <p>This drawer demonstrates:</p>
      <ul class="list-disc list-inside space-y-2 text-sm">
        <li>Snap points (expanded, half, peek, hidden)</li>
        <li>Customizable peek height</li>
        <li>Touch/drag gestures</li>
        <li>Scroll-to-drag conversion when expanded</li>
        <li>Non-modal behavior</li>
        <li>ESC key, close button, and swipe-to-close</li>
        <li>Integration with map viewport updates</li>
      </ul>
      <div class="h-96 bg-muted rounded p-4">
        <p class="text-sm">Scrollable content area</p>
        <div class="h-full overflow-y-auto">
          <div v-for="i in 50" :key="i" class="py-2 border-b">
            Item {{ i }} - This is scrollable content to test the scroll-to-drag conversion
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
