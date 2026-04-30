import {
  ActivityIcon,
  BlocksIcon,
  CodeIcon,
  CogIcon,
  Contact2Icon,
  MapIcon,
  PaintbrushIcon,
  UserRoundIcon,
} from 'lucide-vue-next'
import { PermissionId, type PermissionRule } from '@/types/auth.types'
import type { Icon } from '@/types/app.types'
import type { ThemeColor } from '@/lib/utils'

// The settings index drives the in-page sub-navigation, the cross-tab
// settings search, the sidebar's top-level tabs, and the command palette
// entries. Every section here MUST also be rendered with the matching
// `id` prop on its <SettingsSection>, so URL hash navigation lands on
// the right element.
//
// Items are listed for searchability — they aren't separately anchored
// in the DOM, so navigating to one scrolls to the parent section.

export type SettingsItemDef = {
  titleKey: string
  descriptionKey?: string
  keywords?: string[]
}

export type SettingsSectionDef = {
  id: string
  titleKey: string
  descriptionKey?: string
  keywords?: string[]
  items?: SettingsItemDef[]
}

export type SettingsPageDef = {
  pageId: string
  to: string
  icon: Icon
  // Theme-palette accent for the mobile icon tile. Mirrors the colour
  // language used by place-category icons so the settings list looks like
  // it belongs to the same product, with light/dark-aware tints rendered
  // by ItemIcon.
  iconColor: ThemeColor
  disabled?: boolean
  permissions?: PermissionRule
  sections: SettingsSectionDef[]
}

export const settingsIndex: SettingsPageDef[] = [
  {
    pageId: 'account',
    to: '/settings/account',
    icon: UserRoundIcon,
    iconColor: 'indigo',
    sections: [
      {
        id: 'user',
        titleKey: 'settings.account.user.title',
        keywords: ['name', 'email', 'sign out', 'profile', 'avatar'],
      },
      {
        id: 'identity',
        titleKey: 'friends.identity.title',
        descriptionKey: 'friends.identity.configuredDescription',
        keywords: ['federation', 'handle', 'username', 'server', 'friends'],
        items: [
          {
            titleKey: 'friends.identity.username',
            descriptionKey: 'friends.identity.usernameDescription',
          },
          {
            titleKey: 'friends.identity.server',
            descriptionKey: 'friends.identity.serverDescription',
          },
        ],
      },
      {
        id: 'security',
        titleKey: 'friends.security.title',
        descriptionKey: 'friends.security.description',
        keywords: ['encryption', 'e2ee', 'private key', 'master key'],
        items: [
          {
            titleKey: 'friends.security.recoveryKey',
            descriptionKey: 'friends.security.recoveryKeyDescription',
            keywords: ['backup', 'restore'],
          },
          {
            titleKey: 'friends.security.rotateKeys',
            descriptionKey: 'friends.security.rotateKeysDescription',
            keywords: ['re-encrypt', 'rotate'],
          },
          {
            titleKey: 'friends.security.setupAnotherDevice',
            descriptionKey: 'friends.security.setupAnotherDeviceDescription',
            keywords: ['transfer', 'sync', 'qr code'],
          },
        ],
      },
      {
        id: 'sessions',
        titleKey: 'settings.account.sessions.title',
        keywords: ['devices', 'logout', 'sign out'],
      },
      {
        id: 'passkeys',
        titleKey: 'settings.account.passkeys.title',
        keywords: ['webauthn', 'biometric', 'security key'],
      },
    ],
  },
  {
    pageId: 'behavior',
    to: '/settings/behavior',
    icon: CogIcon,
    iconColor: 'slate',
    sections: [
      {
        id: 'language',
        titleKey: 'settings.behavior.language.title',
        keywords: ['locale', 'translation'],
      },
      {
        id: 'location',
        titleKey: 'settings.mapSettings.location.title',
        items: [
          {
            titleKey: 'settings.mapSettings.location.startupLocation',
            descriptionKey:
              'settings.mapSettings.location.startupLocationDescription',
          },
          {
            titleKey: 'settings.mapSettings.location.locateFlySpeed',
            keywords: ['animation', 'fly to'],
          },
        ],
      },
      {
        id: 'floor-numbering',
        titleKey: 'settings.behavior.floorNumbering.title',
        descriptionKey: 'settings.behavior.floorNumbering.description',
        keywords: ['floors', 'levels', 'ground floor'],
      },
      {
        id: 'units',
        titleKey: 'settings.behavior.units.title',
        descriptionKey: 'settings.behavior.units.description',
        keywords: ['metric', 'imperial', 'temperature', 'distance', 'speed'],
      },
    ],
  },
  {
    pageId: 'appearance',
    to: '/settings/appearance',
    icon: PaintbrushIcon,
    iconColor: 'pink',
    sections: [
      {
        id: 'app-theme',
        titleKey: 'settings.appearance.appTheme.title',
        keywords: ['dark mode', 'light mode', 'color', 'accent'],
        items: [
          { titleKey: 'settings.appearance.appTheme.color.title' },
          { titleKey: 'settings.appearance.appTheme.radius.title' },
          { titleKey: 'settings.appearance.appTheme.theme.title' },
        ],
      },
      {
        id: 'map-theme',
        titleKey: 'settings.appearance.mapTheme.title',
        keywords: ['day', 'night', 'dawn', 'dusk', 'time of day'],
      },
    ],
  },
  {
    pageId: 'mapSettings',
    to: '/settings/map',
    icon: MapIcon,
    iconColor: 'emerald',
    sections: [
      {
        id: 'configuration',
        titleKey: 'settings.mapSettings.configuration.title',
        items: [
          { titleKey: 'settings.mapSettings.configuration.3dObjects' },
          { titleKey: 'settings.mapSettings.configuration.3dTerrain' },
          {
            titleKey: 'settings.mapSettings.configuration.hdRoads',
            descriptionKey:
              'settings.mapSettings.configuration.hdRoadsDescription',
          },
          { titleKey: 'settings.mapSettings.configuration.poiLabels' },
          { titleKey: 'settings.mapSettings.configuration.roadLabels' },
          { titleKey: 'settings.mapSettings.configuration.transitLabels' },
          { titleKey: 'settings.mapSettings.configuration.placeLabels' },
        ],
      },
      {
        id: 'controls',
        titleKey: 'settings.mapSettings.controls.title',
        items: [
          { titleKey: 'settings.mapSettings.controls.zoom' },
          { titleKey: 'settings.mapSettings.controls.compass' },
          { titleKey: 'settings.mapSettings.controls.scale' },
          { titleKey: 'settings.mapSettings.controls.streetView' },
          { titleKey: 'settings.mapSettings.controls.locate' },
          { titleKey: 'settings.mapSettings.controls.weather' },
          { titleKey: 'settings.mapSettings.controls.toolbox' },
        ],
      },
      {
        id: 'style',
        titleKey: 'settings.mapSettings.style.title',
        items: [{ titleKey: 'settings.mapSettings.style.mapStyle' }],
      },
      {
        id: 'layers',
        titleKey: 'settings.mapSettings.layers.title',
        descriptionKey: 'settings.mapSettings.layers.description',
      },
    ],
  },
  {
    pageId: 'integrations',
    to: '/settings/integrations',
    icon: BlocksIcon,
    iconColor: 'amber',
    permissions: {
      any: [
        PermissionId.INTEGRATIONS_READ_USER,
        PermissionId.INTEGRATIONS_READ_SYSTEM,
        PermissionId.INTEGRATIONS_WRITE_SYSTEM,
      ],
    },
    sections: [
      {
        id: 'integrations',
        titleKey: 'settings.integrations.title',
        descriptionKey: 'settings.integrations.description',
        keywords: [
          'integration',
          'connector',
          'service',
          'api',
          'osm',
          'mapbox',
        ],
      },
    ],
  },
  {
    pageId: 'users',
    to: '/settings/users',
    icon: Contact2Icon,
    iconColor: 'sky',
    permissions: {
      any: [
        PermissionId.USERS_READ,
        PermissionId.ROLES_READ,
        PermissionId.PERMISSIONS_READ,
      ],
    },
    sections: [
      {
        id: 'users',
        titleKey: 'settings.users.users.title',
        keywords: ['members', 'workspace'],
      },
      {
        id: 'roles',
        titleKey: 'settings.users.roles.title',
      },
      {
        id: 'permissions',
        titleKey: 'settings.users.permissions.title',
      },
    ],
  },
  {
    pageId: 'system',
    to: '/settings/system',
    icon: ActivityIcon,
    iconColor: 'neutral',
    disabled: true,
    permissions: PermissionId.SYSTEM_READ,
    sections: [],
  },
  // Dev-only entry — surfaces the GPX track simulator for testing
  // location-aware features without physically moving. The whole entry
  // is omitted from the array in production builds, so the page never
  // appears in the nav (route is registered but unreachable from UI).
  ...(import.meta.env.DEV
    ? [
        {
          pageId: 'developer',
          to: '/settings/developer',
          icon: CodeIcon,
          iconColor: 'purple' as const,
          sections: [
            {
              id: 'gpx-simulator',
              titleKey: 'settings.developer.gpxSimulator.title',
              descriptionKey: 'settings.developer.gpxSimulator.description',
              keywords: ['gpx', 'track', 'simulate', 'replay', 'gps', 'mock'],
            },
            {
              id: 'dev-info',
              titleKey: 'settings.developer.info.title',
            },
          ],
        } satisfies SettingsPageDef,
      ]
    : []),
]
