import { logger } from '../../lib/logger'

export interface CacheBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  del(key: string): Promise<void>
  flush(): Promise<void>
  isConnected(): boolean
  getStats(): { hits: number; misses: number; size: number }
}

/**
 * Redis-backed cache using ioredis
 */
export class RedisCacheBackend implements CacheBackend {
  private client: import('ioredis').default | null = null
  private connected = false
  private hits = 0
  private misses = 0

  async connect(config: { url?: string; host?: string; port?: number; password?: string }): Promise<void> {
    const Redis = (await import('ioredis')).default

    if (config.url) {
      this.client = new Redis(config.url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      })
    } else {
      this.client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      })
    }

    this.client.on('error', (err) => {
      logger.error({ err }, 'Redis connection error')
      this.connected = false
    })

    this.client.on('connect', () => {
      this.connected = true
    })

    this.client.on('close', () => {
      this.connected = false
    })

    await this.client.connect()
    this.connected = true
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null
    const value = await this.client.get(key)
    if (value !== null) {
      this.hits++
    } else {
      this.misses++
    }
    return value
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.client) return
    await this.client.set(key, value, 'EX', ttlSeconds)
  }

  async del(key: string): Promise<void> {
    if (!this.client) return
    await this.client.del(key)
  }

  async flush(): Promise<void> {
    if (!this.client) return
    await this.client.flushdb()
  }

  isConnected(): boolean {
    return this.connected
  }

  getStats() {
    return { hits: this.hits, misses: this.misses, size: -1 }
  }
}

/**
 * In-memory LRU cache with TTL for self-hosted deployments without Redis
 */
export class MemoryCacheBackend implements CacheBackend {
  private cache = new Map<string, { value: string; expiresAt: number }>()
  private accessOrder: string[] = []
  private maxSize: number
  private hits = 0
  private misses = 0

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize
  }

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key)
    if (!entry) {
      this.misses++
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    // Move to end of access order (most recently used)
    const idx = this.accessOrder.indexOf(key)
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1)
    }
    this.accessOrder.push(key)

    this.hits++
    return entry.value
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // Evict LRU entries if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const evictKey = this.accessOrder.shift()!
      this.cache.delete(evictKey)
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
    this.accessOrder.push(key)
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key)
    const idx = this.accessOrder.indexOf(key)
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1)
    }
  }

  async flush(): Promise<void> {
    this.cache.clear()
    this.accessOrder = []
  }

  isConnected(): boolean {
    return true
  }

  getStats() {
    return { hits: this.hits, misses: this.misses, size: this.cache.size }
  }
}
