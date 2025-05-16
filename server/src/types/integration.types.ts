export enum IntegrationCapabilityId {
  ROUTING = 'routing',
  GEOCODING = 'geocoding',
  PLACE_INFO = 'place_info',
  IMAGERY = 'imagery',
}

export enum IntegrationId {
  GOOGLE_MAPS = 'google-maps',
  PELIAS = 'pelias',
  GRAPHHOPPER = 'graphhopper',
  YELP = 'yelp',
  OPENTABLE = 'opentable',
  FOURSQUARE = 'foursquare',
  MAPILLARY = 'mapillary',
  NOMINATIM = 'nominatim',
  TRIPADVISOR = 'tripadvisor',
  GEOAPIFY = 'geoapify',
}

export type IntegrationCapability = {
  id: IntegrationCapabilityId
  active: boolean
}

// Integration definition that will be used for available integrations
export type IntegrationDefinition = {
  id: IntegrationId
  name: string
  description: string
  color: string
  capabilities: IntegrationCapabilityId[]
  paid: boolean
  cloud: boolean
  configSchema: string // Reference to schema name used on the client
}

// User-configured integration stored in the database
export type Integration = {
  id: string
  userId: string
  integrationId: IntegrationId
  config: Record<string, any>
  capabilities: IntegrationCapability[]
  createdAt: Date
  updatedAt: Date
}

// Response shape for client
export type IntegrationResponse = {
  id: string
  integrationId: IntegrationId
  capabilities: IntegrationCapability[]
  config: Record<string, any>
}

// Request to create a new integration
export type CreateIntegrationRequest = {
  integrationId: IntegrationId
  config: Record<string, any>
}

// Request to update an integration
export type UpdateIntegrationRequest = {
  config?: Record<string, any>
  capabilities?: IntegrationCapability[]
}

// Response for testing an integration
export type TestIntegrationResponse = {
  success: boolean
  message?: string
}

// Request to test an integration
export type TestIntegrationRequest = {
  integrationId: IntegrationId
  config: Record<string, any>
}
