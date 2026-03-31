// Re-export server types
export * from '@server/types/integration.types'

// Client-side types
import { z } from 'zod'
import { IntegrationDefinition } from '@server/types/integration.types'

// TODO: i18n translate error messages

export const configSchemas: Record<
  IntegrationDefinition['configSchema'],
  z.ZodTypeAny
> = {
  apiKeySchema: z.object({
    apiKey: z.string().min(1, 'API Key is required'),
  }),

  hostConfigSchema: z.object({
    host: z.string().url('Please enter a valid URL'),
    apiKey: z.string().min(1, 'API Key is required'),
  }),

  oauthConfigSchema: z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client Secret is required'),
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
    accessToken: z.string().min(1, 'Access token is required'),
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
    accessToken: z.string().min(1, 'Access token is required'),
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
      .default('http://localhost:3001'),
    apiKey: z.string().optional(),
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
}
