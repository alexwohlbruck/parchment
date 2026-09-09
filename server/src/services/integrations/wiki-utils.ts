import type { Place } from '../../types/place.types'
import { getSourcePriority, extractCommonsFilename } from '../merge.service'

/**
 * Deduplicates photos in a place object, specifically for Wiki integrations
 * Handles both exact URL duplicates and Commons filename duplicates
 * Prioritizes higher source priorities and ensures only one primary photo
 */
export function dedupeWikiPhotos(place: Place): void {
  const urlSet = new Set<string>()
  const commonsMap = new Map<string, number>() // filename -> index in result list
  const result: typeof place.photos = []

  for (const photo of place.photos) {
    const url = photo.value.url
    if (!url) continue

    if (urlSet.has(url)) {
      // Exact URL duplicate; prefer higher source priority
      const existingIndex = result.findIndex(p => p.value.url === url)
      if (existingIndex !== -1) {
        const existing = result[existingIndex]
        if (getSourcePriority(photo.sourceId as any) > getSourcePriority(existing.sourceId as any)) {
          result[existingIndex] = photo
        }
      }
      continue
    }

    const filename = extractCommonsFilename(url)
    if (filename && commonsMap.has(filename)) {
      const existingIndex = commonsMap.get(filename) as number
      const existing = result[existingIndex]
      if (getSourcePriority(photo.sourceId as any) > getSourcePriority(existing.sourceId as any)) {
        result[existingIndex] = photo
      }
      continue
    }

    // Keep and index
    commonsMap.set(filename || `u:${url}`, result.length)
    urlSet.add(url)
    result.push(photo)
  }

  // Ensure only one primary (highest priority)
  if (result.length > 0) {
    let primaryIdx = 0
    let highest = getSourcePriority(result[0].sourceId as any)
    for (let i = 1; i < result.length; i++) {
      const pr = getSourcePriority(result[i].sourceId as any)
      if (pr > highest) { highest = pr; primaryIdx = i }
    }
    result.forEach((p, i) => { p.value.isPrimary = i === primaryIdx })
  }

  place.photos = result
}
