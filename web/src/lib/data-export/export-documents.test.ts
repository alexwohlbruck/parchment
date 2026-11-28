import { describe, expect, it } from 'vitest'
import type { Collection, Bookmark } from '@/types/library.types'
import type { Canvas } from '@/types/canvas.types'
import type { Route } from '@/types/routes.types'
import type { IntegrationRecord } from '@/types/integrations.types'
import {
  exportBookmark,
  exportCanvas,
  exportCollection,
  exportIntegration,
  exportRoute,
  isCanvasLocked,
  isNameLocked,
  isRouteLocked,
  withoutCredentials,
} from './export-documents'

const stamp = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }

const collection: Collection = {
  id: 'c1',
  userId: 'u1',
  isPublic: true,
  scheme: 'server-key',
  resharingPolicy: 'owner-only',
  publicToken: 'share-token',
  publicRole: 'viewer',
  metadataEncrypted: 'ciphertext',
  metadataKeyVersion: 2,
  name: 'Coffee',
  icon: 'Coffee',
  role: 'owner',
  ...stamp,
}

describe('exportCollection', () => {
  it('keeps what the user made and drops share tokens and ciphertext', () => {
    const exported = exportCollection(collection)

    expect(exported).toEqual({
      id: 'c1',
      scheme: 'server-key',
      isPublic: true,
      resharingPolicy: 'owner-only',
      name: 'Coffee',
      description: null,
      icon: 'Coffee',
      iconPack: null,
      iconColor: null,
      createdAt: stamp.createdAt,
      updatedAt: stamp.updatedAt,
      archivedAt: null,
    })
  })

  it("carries a private collection's decrypted places", () => {
    const point = { id: 'p1', externalIds: {}, name: 'Clinic', lat: 1, lng: 2, icon: 'Cross', iconColor: 'red' }

    expect(exportCollection({ ...collection, scheme: 'user-e2ee' }, [point]).points).toEqual([point])
    expect(exportCollection({ ...collection, scheme: 'user-e2ee' }).points).toEqual([])
  })
})

describe('exportBookmark', () => {
  it('drops the owner and treats unknown membership as none', () => {
    const bookmark: Bookmark = {
      id: 'b1',
      externalIds: { osm: 'node/1' },
      name: 'Café',
      lat: 1,
      lng: 2,
      icon: 'Coffee',
      iconColor: 'amber',
      userId: 'u1',
      ...stamp,
    }

    const exported = exportBookmark(bookmark)

    expect(exported).not.toHaveProperty('userId')
    expect(exported.collectionIds).toEqual([])
    expect(exportBookmark({ ...bookmark, collectionIds: ['c2', 'c1'] }).collectionIds).toEqual(['c2', 'c1'])
  })
})

describe('canvases and routes', () => {
  const canvas: Canvas = {
    id: 'cv1',
    userId: 'u1',
    scheme: 'user-e2ee',
    isPublic: false,
    bodyEncrypted: 'ciphertext',
    name: 'Ideas',
    body: { layers: [] },
    ...stamp,
  }
  const route: Route = {
    id: 'r1',
    userId: 'u1',
    mode: 'walking',
    scheme: 'user-e2ee',
    isPublic: false,
    bodyEncrypted: 'ciphertext',
    bodyNonce: 'nonce',
    name: 'Walk',
    body: { waypoints: [], geometry: [] },
    ...stamp,
  }

  it('exports the decrypted body, not the envelope', () => {
    expect(exportCanvas(canvas)).not.toHaveProperty('bodyEncrypted')
    expect(exportCanvas(canvas).body).toEqual({ layers: [] })
    expect(exportRoute({ ...route, body: route.body! })).not.toHaveProperty('bodyNonce')
  })

  it('flags what this device could not decrypt', () => {
    expect(isCanvasLocked(canvas)).toBe(false)
    expect(isCanvasLocked({ ...canvas, body: null })).toBe(true)
    expect(isCanvasLocked({ ...canvas, scheme: 'server-key', undecryptable: true })).toBe(true)
    expect(isRouteLocked(route)).toBe(false)
    expect(isRouteLocked({ ...route, body: null })).toBe(true)
  })

  it('flags a name whose envelope would not open', () => {
    expect(isNameLocked({ metadataEncrypted: 'ciphertext', name: undefined })).toBe(true)
    expect(isNameLocked({ metadataEncrypted: 'ciphertext', name: 'Walk' })).toBe(false)
    expect(isNameLocked({ metadataEncrypted: null, name: null })).toBe(false)
  })
})

describe('integrations', () => {
  it('leaves every credential out of the config', () => {
    expect(
      withoutCredentials({
        host: 'https://tracker.example.com',
        apiKey: 'k',
        api_key: 'k',
        accessToken: 't',
        clientSecret: 's',
        password: 'p',
        nested: { refreshToken: 'r', units: 'km' },
        list: [{ privateKey: 'x', label: 'kept' }],
      }),
    ).toEqual({
      host: 'https://tracker.example.com',
      nested: { units: 'km' },
      list: [{ label: 'kept' }],
    })
  })

  it('keeps which capabilities are on', () => {
    const exported = exportIntegration({
      id: 'i1',
      integrationId: 'dawarich',
      scheme: 'user-e2ee',
      config: { host: 'https://d.example.com', apiKey: 'secret' },
      capabilities: [{ id: 'locationHistory', active: true, metadata: { x: 1 } }],
    } as unknown as IntegrationRecord)

    expect(exported).toEqual({
      id: 'i1',
      integrationId: 'dawarich',
      scheme: 'user-e2ee',
      config: { host: 'https://d.example.com' },
      capabilities: [{ id: 'locationHistory', active: true }],
    })
  })
})
