export const DEV_SESSION_USER_AGENT = 'parchment-dev-sign-in'

const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'parchment-db',
])

export function devSignInRefusal(env: {
  nodeEnv?: string
  dbUrl: string
}): string | null {
  if (env.nodeEnv !== 'development') {
    return `NODE_ENV is "${env.nodeEnv ?? ''}", not "development"`
  }

  let host: string
  try {
    host = new URL(env.dbUrl).hostname
  } catch {
    return 'database URL could not be parsed'
  }

  if (!LOCAL_DB_HOSTS.has(host)) {
    return `database host "${host}" is not a local development database`
  }

  return null
}
