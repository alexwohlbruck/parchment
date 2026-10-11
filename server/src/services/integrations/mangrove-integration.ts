import axios from 'axios'
import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  PlaceReviews,
  ReviewsCapability,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { APP_USER_AGENT, SOURCE } from '../../lib/constants'
import { mangroveSubject, type ReviewSubject } from '../../lib/mangrove'
import {
  adaptMangroveReviews,
  type MangroveReview,
} from './adapters/mangrove-adapter'

const API_URL = 'https://api.mangrove.reviews'
const REVIEW_LIMIT = 200

export interface MangroveConfig extends IntegrationConfig {
  /** Client id registered with Mangrove's signer; enables writing reviews. */
  signerClientId?: string
}

/** Open, signed place reviews from mangrove.reviews. Keyless. */
export class MangroveIntegration implements Integration<MangroveConfig> {
  readonly integrationId = IntegrationId.MANGROVE
  readonly capabilityIds = [IntegrationCapabilityId.REVIEWS]
  readonly capabilities = {
    reviews: {
      getReviews: this.getReviews.bind(this),
    } as ReviewsCapability,
  }
  readonly sources = [SOURCE.MANGROVE]

  initialize(_config: MangroveConfig): void {}

  validateConfig(_config: MangroveConfig): boolean {
    return true
  }

  async testConnection(
    _config: MangroveConfig,
  ): Promise<IntegrationTestResult> {
    try {
      await axios.get(`${API_URL}/reviews`, {
        params: { limit: 1 },
        headers: { 'User-Agent': APP_USER_AGENT },
        timeout: 8000,
      })
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to Mangrove',
      }
    }
  }

  async getReviews(
    subject: ReviewSubject,
    options?: { signal?: AbortSignal },
  ): Promise<PlaceReviews | null> {
    const sub = mangroveSubject(subject)
    const { data } = await axios.get<{ reviews: MangroveReview[] }>(
      `${API_URL}/reviews`,
      {
        params: { sub, limit: REVIEW_LIMIT },
        headers: { 'User-Agent': APP_USER_AGENT },
        timeout: 5000,
        signal: options?.signal,
      },
    )
    return adaptMangroveReviews(data.reviews ?? [], sub)
  }
}
