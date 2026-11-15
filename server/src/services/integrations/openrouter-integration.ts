import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
} from '../../types/integration.types'
import {
  IntegrationId,
  IntegrationCapabilityId,
} from '../../types/integration.enums'
import type {
  ChatCitation,
  ChatRequest,
  ChatResponse,
  LanguageModelCapability,
} from '../../types/language-model.types'

export interface OpenRouterConfig extends IntegrationConfig {
  apiKey: string
  model?: string
}

export const OPENROUTER_API = 'https://openrouter.ai/api/v1'
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5'

const REQUEST_TIMEOUT_MS = 60_000

/**
 * OpenRouter — one key that reaches most hosted models through an
 * OpenAI-compatible API. Configured system-wide by an admin, or by a user with
 * their own key.
 */
export class OpenRouterIntegration implements Integration<OpenRouterConfig> {
  readonly integrationId = IntegrationId.OPENROUTER
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.LANGUAGE_MODEL,
  ]
  readonly capabilities: IntegrationCapabilities = {
    languageModel: {
      complete: this.complete.bind(this),
    } as LanguageModelCapability,
  }

  private config: OpenRouterConfig = { apiKey: '' }
  private initialized = false

  initialize(config: OpenRouterConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API key is required')
    }
    this.config = {
      apiKey: config.apiKey.trim(),
      model: config.model?.trim() || DEFAULT_OPENROUTER_MODEL,
    }
    this.initialized = true
  }

  validateConfig(config: OpenRouterConfig): boolean {
    return !!config?.apiKey?.trim()
  }

  async complete({
    messages,
    tools,
    toolChoice,
    maxTokens,
    webSearch,
    signal,
  }: ChatRequest): Promise<ChatResponse> {
    if (!this.initialized) {
      throw new Error(`Integration ${this.integrationId} has not been initialized`)
    }

    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://parchment.app',
        'X-Title': 'Parchment',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        ...(tools?.length ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(webSearch
          ? { plugins: [{ id: 'web', max_results: webSearch.maxResults }] }
          : {}),
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const body: any = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(
        body?.error?.message || `OpenRouter responded ${response.status}`,
      )
    }

    const message = body?.choices?.[0]?.message
    if (!message) throw new Error('OpenRouter returned no message')

    const citations = urlCitations(message.annotations)
    return {
      message: {
        role: 'assistant',
        content: message.content ?? null,
        ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      },
      ...(citations.length ? { citations } : {}),
      usage: body.usage && {
        promptTokens: body.usage.prompt_tokens ?? 0,
        completionTokens: body.usage.completion_tokens ?? 0,
        ...(typeof body.usage.cost === 'number' ? { cost: body.usage.cost } : {}),
      },
    }
  }

  async testConnection(config: OpenRouterConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'API key is required' }
    }

    try {
      const response = await fetch(`${OPENROUTER_API}/key`, {
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: 'Invalid API key' }
      }
      if (!response.ok) {
        return { success: false, message: `OpenRouter responded ${response.status}` }
      }
      return { success: true, message: 'Connected' }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Could not reach OpenRouter',
      }
    }
  }
}

function urlCitations(annotations: unknown): ChatCitation[] {
  if (!Array.isArray(annotations)) return []
  const byUrl = new Map<string, ChatCitation>()
  for (const annotation of annotations) {
    const { url, title } = annotation?.url_citation ?? {}
    if (annotation?.type !== 'url_citation' || typeof url !== 'string') continue
    if (!byUrl.has(url)) byUrl.set(url, { url, title: typeof title === 'string' && title ? title : url })
  }
  return [...byUrl.values()]
}
