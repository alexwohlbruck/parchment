import { siGooglemaps } from 'simple-icons'
import { z } from 'zod'

export type IntegrationCapability =
  | 'routing'
  | 'geocoding'
  | 'place_info'
  | 'imagery'

export type IntegrationStatus = 'active' | 'inactive' | 'available'

// Schema templates for common integration configurations
export const apiKeySchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  enabled: z.boolean().default(true),
})

export const hostConfigSchema = z.object({
  host: z.string().url('Please enter a valid URL'),
  apiKey: z.string().min(1, 'API Key is required'),
  enabled: z.boolean().default(true),
})

export const oauthConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  enabled: z.boolean().default(true),
})

export type Integration = {
  id: string
  name: string
  description: string
  icon: typeof siGooglemaps | null
  color: string
  capabilities: IntegrationCapability[]
  status?: IntegrationStatus
  paid?: boolean
  cloud?: boolean
  // Schema for configuration - if not provided, defaults to apiKeySchema
  configSchema?: z.ZodObject<any>
}
