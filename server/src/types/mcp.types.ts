export type JsonRpcId = string | number | null

export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: Exclude<JsonRpcId, null>
  method: string
}

export interface JsonRpcError {
  code: number
  message: string
}

export type JsonRpcResponse = { jsonrpc: '2.0'; id: JsonRpcId } & (
  | { result: unknown }
  | { error: JsonRpcError }
)

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}
