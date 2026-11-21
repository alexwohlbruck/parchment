import type { PresetSummary } from '@/types/quick-edit.types'

type PresetTags = Pick<PresetSummary, 'id' | 'tags' | 'addTags'>

function presetTags(preset: PresetTags): Record<string, string> {
  return { ...preset.tags, ...preset.addTags }
}

/**
 * Swaps a feature from one preset to another: the tags that made it the old
 * type go, the new type's come in, and everything else (address, name,
 * building) stays. A chain belongs to the old type, so its brand tags go too.
 * Wildcard values describe a match, not a tag, so they are never written or
 * removed.
 */
export function retagForPreset(
  tags: Record<string, string>,
  from: PresetTags | null,
  to: PresetTags,
): Record<string, string> {
  const next = { ...tags }
  if (from && from.id !== to.id) {
    for (const key of Object.keys(next)) {
      if (key === 'brand' || key.startsWith('brand:')) delete next[key]
    }
    for (const [key, value] of Object.entries(presetTags(from))) {
      if (value !== '*' && next[key] === value) delete next[key]
    }
  }
  for (const [key, value] of Object.entries(presetTags(to))) {
    if (value !== '*') next[key] = value
  }
  return next
}
