<script setup lang="ts">
/**
 * Centered loading state for the directions panel: a little route line with
 * an origin dot, a destination pin, and a vehicle gliding between them while
 * the path draws in. Echoes the trip-timeline aesthetic instead of a plain
 * spinner.
 */
</script>

<template>
  <div class="flex flex-col items-center gap-4 select-none" role="status" aria-live="polite">
    <div class="route-loader" aria-hidden="true">
      <span class="route-track" />
      <span class="route-progress" />
      <span class="route-dot route-dot--start" />
      <span class="route-dot route-dot--end" />
      <span class="route-vehicle" />
    </div>
    <span class="text-sm text-muted-foreground">Finding trips…</span>
  </div>
</template>

<style scoped>
.route-loader {
  position: relative;
  width: 150px;
  height: 14px;
}

.route-track,
.route-progress {
  position: absolute;
  top: 50%;
  left: 1px;
  height: 2px;
  border-radius: 9999px;
  transform: translateY(-50%);
}

.route-track {
  right: 1px;
  background: hsl(var(--muted-foreground) / 0.2);
}

.route-progress {
  width: 0;
  background: hsl(var(--primary));
  animation: route-progress 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

.route-dot {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
}

.route-dot--start {
  left: 0;
  transform: translateY(-50%);
  background: hsl(var(--primary));
}

.route-dot--end {
  right: 0;
  transform: translateY(-50%);
  background: hsl(var(--background));
  border: 2px solid hsl(var(--muted-foreground) / 0.45);
}

.route-vehicle {
  position: absolute;
  top: 50%;
  left: 0;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 4px hsl(var(--primary) / 0.16);
  animation: route-vehicle 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

@keyframes route-progress {
  0% {
    width: 0;
    opacity: 1;
  }
  55% {
    width: calc(100% - 2px);
    opacity: 1;
  }
  78% {
    width: calc(100% - 2px);
    opacity: 1;
  }
  100% {
    width: calc(100% - 2px);
    opacity: 0;
  }
}

@keyframes route-vehicle {
  0% {
    left: 0;
    transform: translate(-50%, -50%) scale(0.85);
    opacity: 0;
  }
  12% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  55% {
    left: calc(100% - 1px);
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  72% {
    left: calc(100% - 1px);
    transform: translate(-50%, -50%) scale(0.85);
    opacity: 0;
  }
  100% {
    left: calc(100% - 1px);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .route-progress {
    width: calc(100% - 2px);
    animation: route-pulse 1.4s ease-in-out infinite;
  }
  .route-vehicle {
    left: 50%;
    transform: translate(-50%, -50%);
    animation: route-pulse 1.4s ease-in-out infinite;
  }
}

@keyframes route-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
