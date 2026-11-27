/** OpenAI-compatible chat shapes, which OpenRouter and most hosted models accept. */

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** A part of a user message; images go as data URLs to models that can read them. */
export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ChatContentPart[] }
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
  /** Let the model read the web first, citing up to this many pages. */
  webSearch?: { maxResults: number }
  signal?: AbortSignal
}

export interface ChatCitation {
  url: string
  title: string
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  /** Credits (USD) the provider charged, when it reports one. */
  cost?: number
}

export interface ChatResponse {
  message: Extract<ChatMessage, { role: 'assistant' }>
  /** Pages a web search read, when the request asked for one. */
  citations?: ChatCitation[]
  usage?: ChatUsage
}

export interface LanguageModelCapability {
  complete(request: ChatRequest): Promise<ChatResponse>
}
