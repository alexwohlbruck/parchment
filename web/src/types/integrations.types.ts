// Re-export server types
export * from '@server/types/integration.types'

// Client-side types
import { siGooglemaps } from 'simple-icons'
import { z } from 'zod'
import {
  IntegrationCapabilityId,
  IntegrationId,
  IntegrationCapability,
} from '@server/types/integration.types'

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
  email: z.string().email('Please enter a valid email for usage tracking'),
})

export const googleMapsSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  clientId: z.string().optional(),
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
  config?: Record<string, any>
  enabled?: boolean
}
