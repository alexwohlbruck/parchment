export interface RedisConfig {
  url?: string
  host: string
  port: number
  password?: string
}

export function getRedisConfig(): RedisConfig | null {
  const url = process.env.REDIS_URL

  if (url) {
    return { url, host: '', port: 0 }
  }

  const host = process.env.REDIS_HOST
  if (!host) {
    return null
  }

  return {
    host,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  }
}
