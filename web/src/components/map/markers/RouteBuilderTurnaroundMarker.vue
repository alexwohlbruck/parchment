<script setup lang="ts">
/**
 * Apple-style turnaround badge shown where a route doubles back on itself
 * (the apex of an out-&-back). White circle with a U-turn glyph.
 */
</script>

<template>
  <div class="turnaround" title="Turnaround">
    <svg viewBox="0 0 24 24" class="turnaround__icon" aria-hidden="true">
      <!-- U-turn: up the left leg, over the top, down the right leg + arrowhead -->
      <path
        d="M8.5 20 V11 a3.5 3.5 0 0 1 7 0 V20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M12.5 16.5 L15.5 20 L18.5 16.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </div>
</template>

<style scoped>
.turnaround {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: #fff;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  color: var(--color-slate-700, #334155);
}
.turnaround__icon {
  width: 16px;
  height: 16px;
}
</style>
