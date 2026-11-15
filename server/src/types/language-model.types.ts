/** OpenAI-compatible chat shapes, which OpenRouter and most hosted models accept. */

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ChatTool[]
  /** Force a tool call (`required`) or leave it to the model (`auto`). */
  toolChoice?: 'auto' | 'required'
  maxTokens?: number
  signal?: AbortSignal
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
}

export interface ChatResponse {
  message: Extract<ChatMessage, { role: 'assistant' }>
  usage?: ChatUsage
}

export interface LanguageModelCapability {
  complete(request: ChatRequest): Promise<ChatResponse>
}
