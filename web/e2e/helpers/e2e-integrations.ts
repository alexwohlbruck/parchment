/**
 * E2E integration setup: sign in as test user via API and configure integrations
 * so the test backend has credentials without committing secrets.
 * Credentials come from .env.test (E2E_MAPBOX_ACCESS_TOKEN, etc.).
 * See web/e2e/env.test.example for all available E2E_* variables.
 */

const TEST_USER_EMAIL = process.env.APP_TESTER_EMAIL || 'test@parchment.local'
const TEST_OTP = '00000000'

function getBaseUrl(): string {
  const base = process.env.SERVER_ORIGIN || 'http://localhost:5001'
  return base.replace(/\/$/, '')
}

async function requestOtp(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER_EMAIL }),
  })
  if (!res.ok && res.status !== 201) {
    throw new Error(`auth/verify failed: ${res.status} ${await res.text()}`)
  }
}

async function getSessionCookie(baseUrl: string): Promise<string> {
  await requestOtp(baseUrl)
  const res = await fetch(`${baseUrl}/auth/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'otp',
      email: TEST_USER_EMAIL,
      token: TEST_OTP,
    }),
    redirect: 'manual',
  })
  if (!res.ok) {
    throw new Error(`auth/sessions failed: ${res.status} ${await res.text()}`)
  }
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  if (cookies.length === 0) {
    const single = res.headers.get('set-cookie')
    if (single) cookies.push(single)
  }
  if (cookies.length === 0) {
    throw new Error('No Set-Cookie from auth/sessions')
  }
  return cookies.map(c => c.split(';')[0]).join('; ')
}

/**
 * Create or update a system integration. Server integrationId and config must match server types.
 */
async function upsertIntegration(
  baseUrl: string,
  cookie: string,
  integrationId: string,
  config: Record<string, string>,
): Promise<void> {
  const listRes = await fetch(`${baseUrl}/integrations/configured`, {
    headers: { Cookie: cookie },
  })
  if (!listRes.ok) {
    throw new Error(`integrations/configured failed: ${listRes.status}`)
  }
  const configured = (await listRes.json()) as { integrationId: string; id: string }[]
  const existing = configured.find((c: { integrationId: string }) => c.integrationId === integrationId)

  if (existing) {
    const putRes = await fetch(`${baseUrl}/integrations/${existing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ config }),
    })
    if (!putRes.ok) {
      throw new Error(`integrations PUT ${integrationId} failed: ${putRes.status} ${await putRes.text()}`)
    }
    return
  }

  const postRes = await fetch(`${baseUrl}/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ integrationId, config }),
  })
  if (!postRes.ok) {
    throw new Error(`integrations POST ${integrationId} failed: ${postRes.status} ${await postRes.text()}`)
  }
}

/**
 * List of integrations we can configure from E2E_* env vars.
 * Keys match server IntegrationId; config keys match each integration's server config schema.
 */
const E2E_INTEGRATIONS: Array<{
  integrationId: string
  envKey: string
  configFromEnv: (val: string) => Record<string, string>
}> = [
  { integrationId: 'mapbox', envKey: 'E2E_MAPBOX_ACCESS_TOKEN', configFromEnv: (v) => ({ accessToken: v }) },
  { integrationId: 'google-maps', envKey: 'E2E_GOOGLE_MAPS_API_KEY', configFromEnv: (v) => ({ apiKey: v }) },
  { integrationId: 'mapillary', envKey: 'E2E_MAPILLARY_ACCESS_TOKEN', configFromEnv: (v) => ({ accessToken: v }) },
  { integrationId: 'geoapify', envKey: 'E2E_GEOAPIFY_API_KEY', configFromEnv: (v) => ({ apiKey: v }) },
  { integrationId: 'transitland', envKey: 'E2E_TRANSITLAND_API_KEY', configFromEnv: (v) => ({ apiKey: v }) },
  { integrationId: 'openweathermap', envKey: 'E2E_OPENWEATHERMAP_API_KEY', configFromEnv: (v) => ({ apiKey: v }) },
  {
    integrationId: 'graphhopper',
    envKey: 'E2E_GRAPHHOPPER_API_KEY',
    configFromEnv: (v) => ({ apiKey: v }),
  },
  {
    integrationId: 'graphhopper',
    envKey: 'E2E_GRAPHHOPPER_HOST',
    configFromEnv: (v) => ({ host: v }),
  },
  {
    integrationId: 'pelias',
    envKey: 'E2E_PELIAS_HOST',
    configFromEnv: (v) => ({ host: v, ...(process.env.E2E_PELIAS_API_KEY?.trim() && { apiKey: process.env.E2E_PELIAS_API_KEY.trim() }) }),
  },
  { integrationId: 'overpass', envKey: 'E2E_OVERPASS_HOST', configFromEnv: (v) => ({ host: v }) },
  { integrationId: 'nominatim', envKey: 'E2E_NOMINATIM_HOST', configFromEnv: (v) => ({ host: v }) },
  { integrationId: 'valhalla', envKey: 'E2E_VALHALLA_HOST', configFromEnv: (v) => ({ host: v }) },
]

/**
 * Run E2E integration setup: for each E2E_* var that is set, configure the corresponding
 * integration on the test server. Call from global-setup after the server is healthy.
 */
export async function setupE2EIntegrations(): Promise<void> {
  const baseUrl = getBaseUrl()
  const byId = new Map<string, Record<string, string>>()

  for (const { integrationId, envKey, configFromEnv } of E2E_INTEGRATIONS) {
    const val = process.env[envKey]?.trim()
    if (!val) continue
    const config = configFromEnv(val)
    const hasRequired = Object.keys(config).some(k => config[k])
    if (!hasRequired) continue
    const merged = byId.get(integrationId) || {}
    Object.assign(merged, config)
    byId.set(integrationId, merged)
  }

  if (byId.size === 0) {
    return
  }

  const cookie = await getSessionCookie(baseUrl)
  for (const [integrationId, config] of byId) {
    const clean = Object.fromEntries(Object.entries(config).filter(([, v]) => v != null && v !== ''))
    if (Object.keys(clean).length === 0) continue
    await upsertIntegration(baseUrl, cookie, integrationId, clean as Record<string, string>)
    console.log(`E2E integrations: ${integrationId} configured.`)
  }
}
