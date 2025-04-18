<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
</script>

<template>
  <div class="library">
    <div class="library-header">
      <h1>Library</h1>
    </div>

    <div class="library-content">
      <!-- Library items will go here -->
      <p>Your saved places will appear here</p>
    </div>
  </div>
</template>

<style scoped>
.library {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border-radius: var(--radius-lg);
}

.library-header {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.library-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
}

.library-content {
  flex: 1;
  padding: 1rem;
  overflow-y: auto;
}
</style>
