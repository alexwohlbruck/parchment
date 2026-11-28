import { describe, expect, it } from 'vitest'
import {
  EXPORT_FORMAT,
  EXPORT_MODULES,
  EXPORT_VERSION,
  ExportFormatError,
  exportDocument,
  readExportDocument,
  serializeDocument,
} from './export-format'
import { EXPORT, META } from './fixtures'

describe('native JSON documents', () => {
  it.each(EXPORT_MODULES)('reads the %s module back exactly as it was written', module => {
    const document = exportDocument(module, EXPORT[module], META)

    expect(readExportDocument(serializeDocument(document))).toEqual(document)
  })

  it('names its format, version and module', () => {
    const document = JSON.parse(serializeDocument(exportDocument('routes', EXPORT.routes, META)))

    expect(document).toMatchObject({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      module: 'routes',
      exportedAt: META.exportedAt,
      appVersion: META.appVersion,
    })
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['another JSON file', JSON.stringify({ type: 'FeatureCollection', features: [] })],
    ['a newer version', JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, module: 'routes', data: {} })],
    ['an unknown module', JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, module: 'photos', data: {} })],
    ['a document with no data', JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, module: 'routes' })],
  ])('refuses %s', (_label, text) => {
    expect(() => readExportDocument(text)).toThrow(ExportFormatError)
  })
})
