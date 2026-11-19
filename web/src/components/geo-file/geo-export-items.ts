import { markRaw, type Component } from 'vue'
import { BracesIcon, EarthIcon, NavigationIcon, SheetIcon } from 'lucide-vue-next'
import type { MenuItemDefinition } from '@/components/responsive/ResponsiveDropdown.vue'
import { EXPORT_FORMATS, type GeoFormat } from '@/lib/geo-file/geo-format'

const ICONS: Record<GeoFormat, Component> = {
  geojson: BracesIcon,
  kml: EarthIcon,
  gpx: NavigationIcon,
  csv: SheetIcon,
}

/** One menu row per export format, labelled for what the file is for. */
export function geoExportItems(
  t: (key: string) => string,
  onExport: (format: GeoFormat) => void,
): MenuItemDefinition[] {
  return EXPORT_FORMATS.map(format => ({
    type: 'item' as const,
    id: `export-${format}`,
    label: t(`geoFile.formats.${format}`),
    icon: markRaw(ICONS[format]),
    onSelect: () => onExport(format),
  }))
}
