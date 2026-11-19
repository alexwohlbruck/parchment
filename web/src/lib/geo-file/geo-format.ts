/** The geospatial file formats Parchment reads and writes. */

export type GeoFormat = 'geojson' | 'kml' | 'gpx' | 'csv'

export const GEO_FORMATS: Record<
  GeoFormat,
  { extension: string; mime: string }
> = {
  geojson: { extension: 'geojson', mime: 'application/geo+json' },
  kml: { extension: 'kml', mime: 'application/vnd.google-earth.kml+xml' },
  gpx: { extension: 'gpx', mime: 'application/gpx+xml' },
  csv: { extension: 'csv', mime: 'text/csv' },
}

/** Formats in the order an export menu offers them. */
export const EXPORT_FORMATS: GeoFormat[] = ['geojson', 'kml', 'gpx', 'csv']

const EXTENSION_FORMATS: Record<string, GeoFormat> = {
  json: 'geojson',
  geojson: 'geojson',
  kml: 'kml',
  gpx: 'gpx',
  csv: 'csv',
  tsv: 'csv',
}

/** File extensions a picker should offer. */
export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_FORMATS)
  .map(extension => `.${extension}`)
  .join(',')

export function formatFromFilename(filename: string): GeoFormat | null {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_FORMATS[extension] ?? null
}

export function geoFilename(name: string, format: GeoFormat): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'parchment'}.${GEO_FORMATS[format].extension}`
}
