import axios, { type AxiosInstance } from 'axios'
import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
  FeedbackCapability,
  FeedbackBoard,
  FeedbackSubmission,
  SubmittedFeedback,
} from '../../types/integration.types'
import { IntegrationId, IntegrationCapabilityId } from '../../types/integration.enums'

export interface QuackbackConfig extends IntegrationConfig {
  url: string
  apiKey: string
}

/** Boards change rarely and every dialog open needs them. */
const BOARDS_TTL_MS = 5 * 60_000

/**
 * Quackback — the feedback provider behind the in-app form. System-scoped:
 * an admin pastes the instance URL and an admin-role API key, and the feedback
 * module reaches it through the feedback capability.
 */
export class QuackbackIntegration implements Integration<QuackbackConfig> {
  readonly integrationId = IntegrationId.QUACKBACK
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.FEEDBACK,
  ]
  readonly capabilities: IntegrationCapabilities = {
    feedback: {
      listBoards: this.listBoards.bind(this),
      submitFeedback: this.submitFeedback.bind(this),
    } as FeedbackCapability,
  }

  private config: QuackbackConfig = { url: '', apiKey: '' }
  private initialized = false
  private boardsCache: { boards: FeedbackBoard[]; expiresAt: number } | null = null

  initialize(config: QuackbackConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: instance URL and API key are required')
    }

    this.config = {
      url: config.url.trim().replace(/\/+$/, ''),
      apiKey: config.apiKey.trim(),
    }
    this.boardsCache = null
    this.initialized = true
  }

  validateConfig(config: QuackbackConfig): boolean {
    return !!(config?.url?.trim() && config?.apiKey?.trim())
  }

  private client(): AxiosInstance {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
    return axios.create({
      baseURL: `${this.config.url}/api/v1`,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      timeout: 10_000,
    })
  }

  private static toBoards(payload: any): FeedbackBoard[] {
    return (payload?.data ?? []).map((board: any) => ({
      id: board.id,
      name: board.name,
      slug: board.slug,
      description: board.description ?? null,
    }))
  }

  async listBoards(): Promise<FeedbackBoard[]> {
    if (this.boardsCache && this.boardsCache.expiresAt > Date.now()) {
      return this.boardsCache.boards
    }

    const { data } = await this.client().get('/boards')
    const boards = QuackbackIntegration.toBoards(data)

    this.boardsCache = { boards, expiresAt: Date.now() + BOARDS_TTL_MS }
    return boards
  }

  /** Exposed for tests and to pick up boards added since the last fetch. */
  clearBoardsCache(): void {
    this.boardsCache = null
  }

  /**
   * File a post on the user's behalf. Their Parchment account is mirrored into
   * Quackback as a portal user so the post carries their name and they get
   * notified when it ships.
   */
  async submitFeedback({
    boardId,
    title,
    content,
    author,
  }: FeedbackSubmission): Promise<SubmittedFeedback> {
    const api = this.client()

    const { data: identified } = await api.post('/users/identify', {
      email: author.email,
      ...(author.name ? { name: author.name } : {}),
    })
    const authorPrincipalId = identified?.data?.principalId

    const { data: created } = await api.post('/posts', {
      boardId,
      title,
      content,
      ...(authorPrincipalId ? { authorPrincipalId } : {}),
    })

    const id = created?.data?.id
    const slug = (await this.listBoards()).find(board => board.id === boardId)?.slug

    return {
      id,
      url: slug && id ? `${this.config.url}/b/${slug}/posts/${id}` : null,
    }
  }

  async testConnection(config: QuackbackConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Instance URL and API key are required' }
    }

    const url = config.url.trim().replace(/\/+$/, '')

    try {
      // Listing boards is the cheapest authenticated read, and it doubles as a
      // check that the key can see something worth filing feedback against.
      const { data } = await axios.get(`${url}/api/v1/boards`, {
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        timeout: 10_000,
      })

      const boards = QuackbackIntegration.toBoards(data)
      if (boards.length === 0) {
        return {
          success: false,
          message: 'Connected, but no boards exist yet — create one in Quackback first',
        }
      }

      return {
        success: true,
        message: `Connected — ${boards.length} board${boards.length === 1 ? '' : 's'} available`,
      }
    } catch (error: any) {
      const status = error?.response?.status
      if (status === 401 || status === 403) {
        return { success: false, message: 'Invalid API key' }
      }
      return {
        success: false,
        message: error?.message || 'Could not reach the Quackback instance',
      }
    }
  }
}
