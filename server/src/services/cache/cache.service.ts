import { logger } from '../../lib/logger'
import { getRedisConfig } from '../../config/redis.config'
import {
  CacheBackend,
  RedisCacheBackend,
  MemoryCacheBackend,
} from './cache-backend'

export class CacheService {
  private backend: CacheBackend | null = null
  private inflight = new Map<string, Promise<any>>()
  private backendType: 'redis' | 'memory' = 'memory'

  async initialize(): Promise<void> {
    const redisConfig = getRedisConfig()

    if (redisConfig) {
      try {
        const redis = new RedisCacheBackend()
        await redis.connect(redisConfig)
        this.backend = redis
        this.backendType = 'redis'
        logger.info('Cache initialized with Redis backend')
        return
      } catch (err) {
        logger.warn({ err }, 'Failed to connect to Redis, falling back to in-memory cache')
      }
    }

    this.backend = new MemoryCacheBackend()
    this.backendType = 'memory'
    logger.info('Cache initialized with in-memory backend')
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.backend) return null
    try {
      const raw = await this.backend.get(key)
      if (raw === null) return null
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    if (!this.backend || ttlSeconds <= 0) return
    try {
      await this.backend.set(key, JSON.stringify(value), ttlSeconds)
    } catch (err) {
      logger.warn({ err, key }, 'Cache set failed')
    }
  }

  async del(key: string): Promise<void> {
    if (!this.backend) return
    try {
      await this.backend.del(key)
    } catch (err) {
      logger.warn({ err, key }, 'Cache delete failed')
    }
  }

  /**
   * Cache-aside with request deduplication.
   * If the same key is already being fetched, piggyback on the in-flight promise.
   */
  async getOrFetch<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    // TTL of 0 means skip caching entirely
    if (ttlSeconds <= 0) {
      return fetchFn()
    }

    // Check cache first
    const cached = await this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // Check for in-flight request with same key
    const existing = this.inflight.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    // Execute fetch with deduplication
    const promise = fetchFn()
      .then(async (result) => {
        await this.set(key, result, ttlSeconds)
        return result
      })
      .finally(() => {
        this.inflight.delete(key)
      })

    this.inflight.set(key, promise)
    return promise
  }

  getBackendType(): string {
    return this.backendType
  }

  getStats() {
    if (!this.backend) return { hits: 0, misses: 0, size: 0, backend: 'none' }
    return { ...this.backend.getStats(), backend: this.backendType }
  }

  isConnected(): boolean {
    return this.backend?.isConnected() ?? false
  }
}
