import { getPresetById, getPresetName } from '../../lib/osm-presets'
import { resolvePresetIcon } from '../../lib/place-categories'
import type { Language } from '../../lib/i18n/i18n.types'
import type { PackagePlace, PlacesPackage } from '../../types/offline-package.types'

type Label = Pick<PackagePlace, 'placeType' | 'icon' | 'iconPack'>

function labelFor(category: string, language: Language): Label {
  const preset = getPresetById(category)
  const { icon, iconPack } = resolvePresetIcon(category, preset?.icon)
  return { placeType: preset ? getPresetName(preset, language) : undefined, icon, iconPack }
}

/** Name each place's kind and icon the way the app's own place pages do. */
export function labelPlaces(pkg: PlacesPackage, language: Language): PlacesPackage {
  const labels = new Map<string, Label>()
  for (const place of pkg.places) {
    if (!place.category || place.transit) continue
    let label = labels.get(place.category)
    if (!label) {
      label = labelFor(place.category, language)
      labels.set(place.category, label)
    }
    Object.assign(place, label)
  }
  return pkg
}
