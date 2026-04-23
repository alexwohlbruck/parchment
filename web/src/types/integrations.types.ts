// Re-export server types
export * from '@server/types/integration.types'

// Client-side types
import { z } from 'zod'
import { IntegrationDefinition } from '@server/types/integration.types'
import { DependencyType, type Dependency, type Config } from '@/components/ui/auto-form/interface'

// TODO: i18n translate error messages

export interface SchemaConfig {
  fieldConfig?: Config<any>
  dependencies?: Dependency<any>[]
}

/** Per-schema field config and dependencies for AutoForm. */
export const schemaConfigs: Partial<Record<string, SchemaConfig>> = {
  openstreetmapSystemSchema: {
    fieldConfig: {
      server: {
        label: 'Server',
        description: 'Which OpenStreetMap instance to connect to',
      },
      customServerUrl: {
        label: 'Custom Server URL',
        inputProps: {
          placeholder: 'https://your-osm-instance.example.com',
        },
      },
      clientId: {
        label: 'Client ID',
      },
      clientSecret: {
        label: 'Client Secret',
      },
      redirectUri: {
        label: 'Redirect URI',
        description: 'Must match the redirect URI registered in your OSM OAuth app. HTTPS is required by OSM.',
        inputProps: {
          placeholder: 'https://your-server.example.com/integrations/osm/callback',
        },
      },
    },
    dependencies: [
      {
        sourceField: 'server',
        targetField: 'customServerUrl',
        type: DependencyType.HIDES,
        when: (serverValue: string) => serverValue !== 'custom',
      },
      {
        sourceField: 'server',
        targetField: 'customServerUrl',
        type: DependencyType.REQUIRES,
        when: (serverValue: string) => serverValue === 'custom',
      },
    ],
  },
}

export const configSchemas: Record<
  IntegrationDefinition['configSchema'],
  z.ZodTypeAny
> = {
  apiKeySchema: z.object({
    apiKey: z.string().min(1, 'API Key is required').describe('public'),
  }),

  hostConfigSchema: z.object({
    host: z.string().url('Please enter a valid URL'),
    apiKey: z.string().min(1, 'API Key is required'),
  }),

  oauthConfigSchema: z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client Secret is required'),
  }),

  openstreetmapSystemSchema: z.object({
    server: z
      .enum(['production', 'sandbox', 'custom'])
      .default('production')
      .describe('public'),
    customServerUrl: z.string().url('Please enter a valid URL').optional().describe('public'),
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().optional(),
    redirectUri: z.string().url('Please enter a valid URL').optional(),
  }),

  nominatimSchema: z.object({
    host: z
      .string()
      .url('Please enter a valid URL')
      .default('https://nominatim.openstreetmap.org'),
  }),

  overpassSchema: z.object({
    host: z
      .string()
      .url('Please enter a valid URL')
      .default('https://overpass-api.de/api/interpreter'),
  }),

  googleMapsSchema: z.object({
    apiKey: z.string().min(1, 'API Key is required'),
  }),

  peliasSchema: z.object({
    host: z.string().url('Please enter a valid URL'),
  }),

  mapboxSchema: z.object({
    accessToken: z.string().min(1, 'Access token is required').describe('public'),
  }),

  valhallaSchema: z.object({
    host: z.string().url('Please enter a valid URL'),
  }),

  graphhopperSchema: z.object({
    host: z.string().url('Please enter a valid URL').optional().default('https://graphhopper.com/api/1'),
    apiKey: z.string().min(1, 'API Key is required').optional(),
  }).refine(
    (data) => data.host || data.apiKey,
    {
      message: 'Either host (for self-hosted) or API Key (for GraphHopper API) is required',
      path: ['host'],
    }
  ),

  mapillarySchema: z.object({
    accessToken: z.string().min(1, 'Access token is required').describe('public'),
  }),

  transitlandSchema: z.object({
    apiKey: z.string().min(1, 'API Key is required'),
  }),

  geoapifySchema: z.object({
    apiKey: z.string().min(1, 'API Key is required'),
  }),

  wikidataSchema: z.object({
    // Wikidata doesn't require any configuration
  }),

  wikipediaSchema: z.object({
    // Wikipedia doesn't require any configuration
  }),

  wikimediaSchema: z.object({
    // Wikimedia Commons doesn't require any configuration
  }),

  barrelmanSchema: z.object({
    host: z
      .string()
      .url('Please enter a valid URL')
      .default('http://localhost:5001'),
    apiKey: z.string().optional(),
    tileKey: z.string().optional(),
  }),

  axiomSchema: z.object({
    endpoint: z
      .string()
      .url('Please enter a valid URL')
      .optional()
      .default('https://api.axiom.co'),
    apiToken: z.string().min(1, 'API token is required'),
    dataset: z.string().min(1, 'Dataset name is required'),
  }),

  openstreetmapOAuthSchema: z.object({
    // No user-editable fields — config is managed by OAuth2 flow
  }),

  dawarichSchema: z.object({
    url: z
      .string()
      .url('Please enter a valid URL')
      .describe('Base URL of your Dawarich instance, e.g. https://dawarich.example.com'),
    apiToken: z
      .string()
      .min(1, 'API token is required')
      .describe('API token from your Dawarich account'),
  }),
}
