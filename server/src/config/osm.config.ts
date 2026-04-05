export type OsmServer = 'production' | 'sandbox'

const OSM_SERVERS = {
  production: 'https://www.openstreetmap.org',
  sandbox: 'https://master.apis.dev.openstreetmap.org',
} as const

const server: OsmServer = (process.env.OSM_SERVER as OsmServer) || 'production'

const osmBase = OSM_SERVERS[server]

export const osmConfig = {
  server,
  apiBase: `${osmBase}/api/0.6`,
  authEndpoint: `${osmBase}/oauth2/authorize`,
  tokenEndpoint: `${osmBase}/oauth2/token`,
}
