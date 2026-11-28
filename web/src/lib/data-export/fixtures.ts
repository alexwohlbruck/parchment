/** A small export covering each module, for the export tests. */

import type { ExportData, ExportMeta } from '@/lib/data-export/export-format'

export const META: ExportMeta = { exportedAt: '2026-11-27T12:00:00.000Z', appVersion: '0.27.2' }

const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', archivedAt: null }

export const EXPORT: ExportData = {
  library: {
    collections: [
      {
        id: 'c-public',
        scheme: 'server-key',
        isPublic: false,
        resharingPolicy: 'owner-only',
        name: 'Coffee',
        description: 'Good espresso',
        icon: 'Coffee',
        iconPack: 'lucide',
        iconColor: 'amber',
        ...stamp,
      },
      {
        id: 'c-private',
        scheme: 'user-e2ee',
        isPublic: false,
        resharingPolicy: 'owner-only',
        name: 'Doctors',
        description: null,
        icon: null,
        iconPack: null,
        iconColor: null,
        ...stamp,
        points: [
          {
            id: 'p1',
            externalIds: { osm: 'node/7' },
            name: 'Clinic <East>',
            address: '1 Main St',
            lat: 35.2,
            lng: -80.8,
            icon: 'Stethoscope',
            iconColor: 'red',
          },
        ],
      },
    ],
    bookmarks: [
      {
        id: 'b1',
        externalIds: { osm: 'node/1' },
        name: 'Café & Bar',
        address: '2 Elm St',
        lat: 40.75,
        lng: -73.98,
        icon: 'Coffee',
        iconColor: 'amber',
        createdAt: stamp.createdAt,
        updatedAt: stamp.updatedAt,
        collectionIds: ['c-public'],
      },
    ],
    canvases: [
      {
        id: 'cv1',
        scheme: 'user-e2ee',
        isPublic: false,
        name: 'Trip ideas',
        description: null,
        icon: null,
        iconPack: null,
        iconColor: null,
        ...stamp,
        body: { layers: [], camera: { center: [-80.8, 35.2], zoom: 12 } },
      },
    ],
  },
  routes: {
    routes: [
      {
        id: 'r1',
        scheme: 'user-e2ee',
        mode: 'cycling',
        isPublic: false,
        name: 'Greenway loop',
        description: 'Sunday ride',
        icon: null,
        iconPack: null,
        iconColor: null,
        ...stamp,
        body: {
          waypoints: [{ lat: 35, lng: -80 }, { lat: 35.1, lng: -80.1 }],
          geometry: [[-80, 35], [-80.05, 35.05], [-80.1, 35.1]],
          elevation: [200, 210, 205],
          stats: { distance: 15000, duration: 3600 },
        },
      },
    ],
  },
  vehicles: { vehicles: [] },
  preferences: {
    language: 'en-US',
    unitSystem: 'metric',
    navigation: {} as ExportData['preferences']['navigation'],
    ask: {} as ExportData['preferences']['ask'],
    app: {},
  },
  history: {
    searches: [{ query: 'pizza', kind: 'text', at: 1764000000000 }],
    places: [{ id: 'osm/node/1', title: 'Café & Bar', at: 1764000000000 }],
  },
  friends: { friends: [], invitations: [], locationSharing: [] },
  integrations: { integrations: [] },
  osmEdits: { edits: [] },
  account: {
    id: 'u1',
    email: 'someone@example.com',
    firstName: 'Sam',
    lastName: null,
    alias: 'sam',
    picture: null,
  },
}
