/** Laying an export out as files, and packing them into one download. */

import dayjs from 'dayjs'
import { strToU8, zipSync } from 'fflate'
import { toGpx, toKml } from '@/lib/geo-file/geo-write'
import {
  EXPORT_FORMAT,
  EXPORT_MODULES,
  EXPORT_VERSION,
  exportDocument,
  serializeDocument,
  type ExportData,
  type ExportMeta,
  type ExportModuleId,
} from '@/lib/data-export/export-format'
import { libraryPlaces, routeTracks } from '@/lib/data-export/export-geo'
import type { ExportIssue } from '@/lib/data-export/export-documents'

export type ExportFileFormat = 'json' | 'geojson' | 'kml' | 'gpx'

export interface ExportFile {
  path: string
  module: ExportModuleId
  format: ExportFileFormat
  content: string
}

export interface ExportManifest {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  appVersion: string
  modules: ExportModuleId[]
  files: Omit<ExportFile, 'content'>[]
  issues: ExportIssue[]
  failedModules: ExportModuleId[]
}

export const MANIFEST_PATH = 'manifest.json'

const MIME: Record<ExportFileFormat | 'zip', string> = {
  json: 'application/json',
  geojson: 'application/geo+json',
  kml: 'application/vnd.google-earth.kml+xml',
  gpx: 'application/gpx+xml',
  zip: 'application/zip',
}

const slug = (module: ExportModuleId) => module.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)

/** The exported modules, in their fixed order. */
export function exportedModules(data: Partial<ExportData>): ExportModuleId[] {
  return EXPORT_MODULES.filter(module => data[module] !== undefined)
}

function openFormatFiles(data: Partial<ExportData>, module: ExportModuleId): ExportFile[] {
  if (module === 'library' && data.library) {
    const places = libraryPlaces(data.library)
    if (!places.features.length) return []
    return [
      { path: 'library-places.geojson', module, format: 'geojson', content: JSON.stringify(places) },
      { path: 'library-places.kml', module, format: 'kml', content: toKml(places, 'Saved places') },
    ]
  }
  if (module === 'routes' && data.routes) {
    const tracks = routeTracks(data.routes.routes)
    if (!tracks.features.length) return []
    return [{ path: 'routes.gpx', module, format: 'gpx', content: toGpx(tracks, 'Saved routes') }]
  }
  return []
}

/** One native JSON file per module, plus the open formats that fit it. */
export function exportFiles(data: Partial<ExportData>, meta: ExportMeta): ExportFile[] {
  return exportedModules(data).flatMap(module => [
    {
      path: `${slug(module)}.json`,
      module,
      format: 'json' as const,
      content: serializeDocument(exportDocument(module, data[module]!, meta)),
    },
    ...openFormatFiles(data, module),
  ])
}

export function exportManifest(
  data: Partial<ExportData>,
  files: ExportFile[],
  meta: ExportMeta,
  issues: ExportIssue[] = [],
  failedModules: ExportModuleId[] = [],
): ExportManifest {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    ...meta,
    modules: exportedModules(data),
    files: files.map(({ content: _content, ...file }) => file),
    issues,
    failedModules,
  }
}

export function zipFiles(entries: { path: string; content: string }[]): Uint8Array {
  return zipSync(Object.fromEntries(entries.map(e => [e.path, strToU8(e.content)])), { level: 6 })
}

export interface ExportPackage {
  blob: Blob
  filename: string
}

/**
 * A single file when that is all there is, otherwise a zip with a manifest
 * listing every file, anything this device couldn't decrypt, and any module
 * that couldn't be fetched.
 */
export function packageExport(
  data: Partial<ExportData>,
  meta: ExportMeta,
  issues: ExportIssue[] = [],
  failedModules: ExportModuleId[] = [],
): ExportPackage {
  const files = exportFiles(data, meta)
  const modules = exportedModules(data)
  const date = dayjs(meta.exportedAt).format('YYYY-MM-DD')
  const name = modules.length === 1 ? `parchment-${slug(modules[0])}-${date}` : `parchment-export-${date}`

  if (files.length === 1 && !issues.length && !failedModules.length) {
    const [file] = files
    return {
      blob: new Blob([file.content], { type: MIME[file.format] }),
      filename: `${name}.${file.format}`,
    }
  }

  const manifest = exportManifest(data, files, meta, issues, failedModules)
  const zip = zipFiles([
    { path: MANIFEST_PATH, content: JSON.stringify(manifest, null, 2) + '\n' },
    ...files,
  ])
  return { blob: new Blob([zip as BlobPart], { type: MIME.zip }), filename: `${name}.zip` }
}
