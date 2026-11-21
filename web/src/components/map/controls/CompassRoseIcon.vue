<script setup lang="ts">
const point = (angle: number, length: number, width: number) => {
  const rad = (angle * Math.PI) / 180
  const at = (r: number, a: number) => `${(12 + r * Math.sin(a)).toFixed(2)},${(12 - r * Math.cos(a)).toFixed(2)}`
  const tip = at(length, rad)
  return {
    left: `M12,12 L${tip} L${at(width, rad - Math.PI / 2)} Z`,
    right: `M12,12 L${tip} L${at(width, rad + Math.PI / 2)} Z`,
  }
}

const cardinals = [0, 90, 180, 270].map(a => ({ angle: a, ...point(a, 11.4, 2.1) }))
const ordinals = [45, 135, 225, 315].map(a => point(a, 7.6, 1.6))
</script>

<template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="6.4" stroke="currentColor" stroke-width="0.5" stroke-opacity="0.6" />
    <circle cx="12" cy="12" r="7.4" stroke="currentColor" stroke-width="0.35" stroke-opacity="0.4" />
    <g v-for="(p, i) in ordinals" :key="`o${i}`">
      <path :d="p.left" fill="currentColor" fill-opacity="0.55" />
      <path :d="p.right" fill="currentColor" fill-opacity="0.2" />
    </g>
    <g v-for="p in cardinals" :key="p.angle">
      <path :d="p.left" :fill="p.angle === 0 ? 'hsl(8, 58%, 42%)' : 'currentColor'" fill-opacity="0.95" />
      <path :d="p.right" fill="currentColor" :fill-opacity="p.angle === 0 ? 0.45 : 0.3" />
    </g>
    <circle cx="12" cy="12" r="0.9" fill="currentColor" />
  </svg>
</template>
