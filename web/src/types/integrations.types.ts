import { siGooglemaps } from 'simple-icons'

export type IntegrationCapability =
  | 'routing'
  | 'geocoding'
  | 'place_info'
  | 'imagery'

export type IntegrationStatus = 'active' | 'inactive' | 'available'

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
}
