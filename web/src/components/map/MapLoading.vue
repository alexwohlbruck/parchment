<script setup lang="ts">
import ParchmentLogo from '@/assets/parchment.svg?component'

// Cute map-related loading messages
const messages = [
  'Charting your course...',
  'Unrolling the parchment...',
  'Discovering new horizons...',
  'Mapping the terrain...',
  'Plotting coordinates...',
]

const randomMessage = messages[Math.floor(Math.random() * messages.length)]
</script>

<template>
  <div class="flex items-center justify-center h-full w-full bg-background">
    <div class="flex flex-col items-center gap-6">
      <!-- Animated logo -->
      <div class="relative">
        <!-- Subtle glow effect -->
        <div class="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
        
        <!-- Logo with gentle animation -->
        <ParchmentLogo
          class="relative size-16 text-primary drop-shadow-lg animate-float"
        />
      </div>
      
      <!-- Loading text -->
      <div class="flex flex-col items-center gap-2">
        <span class="text-lg font-medium text-foreground">
          {{ randomMessage }}
        </span>
        
        <!-- Animated dots -->
        <div class="flex gap-1.5">
          <span
            v-for="i in 3"
            :key="i"
            class="size-1.5 rounded-full bg-primary/60 animate-bounce"
            :style="{ animationDelay: `${(i - 1) * 150}ms` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-8px) rotate(2deg);
  }
}

.animate-float {
  animation: float 2s ease-in-out infinite;
}
</style>
