// Re-export server types
export * from '@server/types/integration.types'

// Client-side types
import { siGooglemaps } from 'simple-icons'
import { z } from 'zod'
import {
  IntegrationCapabilityId,
  IntegrationCapability,
  IntegrationConfig,
} from '@server/types/integration.types'

// TODO: i18n translate error messages

// Schema templates for form validation
export const apiKeySchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
})

export const hostConfigSchema = z.object({
  host: z.string().url('Please enter a valid URL'),
  apiKey: z.string().min(1, 'API Key is required'),
})

export const oauthConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
})

export const nominatimSchema = z.object({
  host: z
    .string()
    .url('Please enter a valid URL')
    .default('https://nominatim.openstreetmap.org'),
})

export const overpassSchema = z.object({
  host: z
    .string()
    .url('Please enter a valid URL')
    .default('https://overpass-api.de/api/interpreter'),
})

export const googleMapsSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
})

export const peliasSchema = z.object({
  host: z.string().url('Please enter a valid URL'),
})

// UI-specific integration type that combines server data with UI elements
export type UiIntegration = {
  id: string
  integrationId?: string
  name: string
  description: string
  icon: typeof siGooglemaps | null
  color: string
  capabilities: IntegrationCapabilityId[]
  capabilityRecords?: IntegrationCapability[] // Array of capability objects with active status
  status: 'active' | 'inactive' | 'available'
  paid: boolean
  cloud: boolean
  configSchema?: string | z.ZodObject<any>
  config?: IntegrationConfig
  enabled?: boolean
}
