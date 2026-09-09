<script setup lang="ts">
import { computed } from 'vue'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  place: Partial<Place>
}>()

// Only sources that have a display name, deduped by id (falling back to name)
// so a source contributed by multiple integrations isn't listed twice — and a
// malformed nameless source can't leave a dangling "and" separator.
const sources = computed(() => {
  const seen = new Set<string>()
  const result: { key: string; name: string; url?: string }[] = []
  for (const source of props.place.sources ?? []) {
    const name = source.name?.trim()
    if (!name) continue
    const key = source.id ?? name
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ key, name, url: source.url })
  }
  return result
})

// Separator before the source at index `i`: nothing for the first, " and "
// before the last, ", " otherwise. Reads correctly for any number of sources.
function separatorBefore(i: number): string {
  if (i === 0) return ''
  if (i === sources.value.length - 1) return ' and '
  return ', '
}
</script>

<template>
  <div
    v-if="sources.length"
    class="px-3.5 py-2.5 rounded-lg border text-xs text-muted-foreground"
  >
    Data from
    <template v-for="(source, i) in sources" :key="source.key">
      <template v-if="i > 0">{{ separatorBefore(i) }}</template>
      <a
        v-if="source.url"
        :href="source.url"
        target="_blank"
        rel="noopener noreferrer"
        class="font-semibold text-foreground/80 hover:underline"
      >{{ source.name }}</a>
      <strong v-else class="text-foreground/80">{{ source.name }}</strong>
    </template>
  </div>
</template>
