<script setup lang="ts">
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'

const router = useRouter()

const goHome = () => {
  router.push({ name: AppRoute.MAP })
}
</script>

<template>
  <div class="not-found">
    <div class="not-found-content">
      <h1>404</h1>
      <h2>Page Not Found</h2>
      <p>The page you're looking for doesn't exist or has been moved.</p>
      <button class="primary" @click="goHome">Return to Map</button>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background);
}

.not-found-content {
  text-align: center;
  padding: 2rem;
}

.not-found-content h1 {
  font-size: 6rem;
  font-weight: 700;
  margin: 0;
  color: var(--color-primary);
  line-height: 1;
}

.not-found-content h2 {
  font-size: 2rem;
  font-weight: 600;
  margin: 1rem 0;
}

.not-found-content p {
  color: var(--color-text-secondary);
  margin-bottom: 2rem;
}

button {
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
}

button.primary {
  background: var(--color-primary);
  color: white;
  border: none;
}

button.primary:hover {
  background: var(--color-primary-dark);
}
</style>
