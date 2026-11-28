import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { readExportDocument } from './export-format'
import { MANIFEST_PATH, exportFiles, packageExport } from './export-archive'
import { EXPORT, META } from './fixtures'

async function unzip(blob: Blob): Promise<Record<string, string>> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  return Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, strFromU8(bytes)]))
}

describe('exportFiles', () => {
  it('writes one JSON file per module, plus open formats for places and routes', () => {
    expect(exportFiles(EXPORT, META).map(f => f.path)).toEqual([
      'library.json',
      'library-places.geojson',
      'library-places.kml',
      'routes.json',
      'routes.gpx',
      'vehicles.json',
      'preferences.json',
      'history.json',
      'friends.json',
      'integrations.json',
      'osm-edits.json',
      'account.json',
    ])
  })

  it('writes no open format for a library with no places', () => {
    const empty = { ...EXPORT.library, bookmarks: [], collections: [] }

    expect(exportFiles({ library: empty }, META).map(f => f.path)).toEqual(['library.json'])
  })
})

describe('packageExport', () => {
  it('zips every module with a manifest', async () => {
    const { blob, filename } = packageExport(EXPORT, META)
    const files = await unzip(blob)
    const manifest = JSON.parse(files[MANIFEST_PATH])

    expect(filename).toBe('parchment-export-2026-11-27.zip')
    expect(blob.type).toBe('application/zip')
    expect(manifest.modules).toHaveLength(9)
    expect(manifest.files.map((f: { path: string }) => f.path).sort()).toEqual(
      Object.keys(files).filter(p => p !== MANIFEST_PATH).sort(),
    )
  })

  it('round-trips each module through the archive', async () => {
    const files = await unzip(packageExport(EXPORT, META).blob)

    expect(readExportDocument(files['library.json']).data).toEqual(EXPORT.library)
    expect(readExportDocument(files['osm-edits.json']).data).toEqual(EXPORT.osmEdits)
  })

  it('hands over a single module as its own file when it has only one', () => {
    const { blob, filename } = packageExport({ vehicles: EXPORT.vehicles }, META)

    expect(filename).toBe('parchment-vehicles-2026-11-27.json')
    expect(blob.type).toBe('application/json')
  })

  it('zips a single module that comes with open formats', async () => {
    const { blob, filename } = packageExport({ routes: EXPORT.routes }, META)

    expect(filename).toBe('parchment-routes-2026-11-27.zip')
    expect(Object.keys(await unzip(blob)).sort()).toEqual([MANIFEST_PATH, 'routes.gpx', 'routes.json'])
  })

  it("lists in the manifest what this device couldn't decrypt", async () => {
    const issues = [{ kind: 'route' as const, id: 'r9', reason: 'locked' as const }]
    const files = await unzip(packageExport({ vehicles: EXPORT.vehicles }, META, issues).blob)

    expect(JSON.parse(files[MANIFEST_PATH]).issues).toEqual(issues)
  })
})
