import { version } from '../../../package.json'
import { logError } from '../../lib/logger'
import { askTools, type AskContext } from './ask-tools'
import type { Language } from '../../lib/i18n/i18n.types'
import type { LatLng } from '../../types/ask.types'
import type { Place } from '../../types/place.types'
import type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  McpTool,
  McpToolResult,
} from '../../types/mcp.types'

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']

export const RpcErrorCode = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
} as const

export interface McpCaller {
  userId: string
  language: Language
  signal?: AbortSignal
}

const INSTRUCTIONS =
  'Search Parchment for real places. Searches need a location: pass `near`/`from` coordinates, or resolve a place name with `locate` first.'

const toolsByName = new Map(askTools.map((tool) => [tool.name, tool]))

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

export function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function listMcpTools(): McpTool[] {
  return askTools.map(({ name, description, parameters }) => ({
    name,
    description,
    inputSchema: parameters,
  }))
}

function initialize(params: Record<string, unknown> = {}) {
  const requested = params.protocolVersion
  return {
    protocolVersion:
      typeof requested === 'string' && MCP_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSIONS[0],
    capabilities: { tools: {} },
    serverInfo: { name: 'parchment', title: 'Parchment', version },
    instructions: INSTRUCTIONS,
  }
}

async function callTool(
  params: Record<string, unknown> = {},
  caller: McpCaller,
): Promise<McpToolResult> {
  const tool = toolsByName.get(params.name as string)
  if (!tool) throw new RpcError(RpcErrorCode.INVALID_PARAMS, `Unknown tool ${params.name}`)

  const args = (params.arguments ?? {}) as Record<string, any>
  const context: AskContext = {
    userId: caller.userId,
    language: caller.language,
    origin: (args.near ?? args.from) as LatLng | undefined,
    now: new Date(),
    signal: caller.signal,
    seen: new Map<string, Place>(),
    emit: () => {},
  }

  try {
    const result = await tool.run(args, context)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (error) {
    logError(`MCP tool ${tool.name} failed`, error)
    return { content: [{ type: 'text', text: (error as Error).message }], isError: true }
  }
}

async function dispatch(request: JsonRpcRequest, caller: McpCaller): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return initialize(request.params)
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: listMcpTools() }
    case 'tools/call':
      return callTool(request.params, caller)
    default:
      throw new RpcError(RpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${request.method}`)
  }
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  caller: McpCaller,
): Promise<JsonRpcResponse> {
  try {
    return { jsonrpc: '2.0', id: request.id, result: await dispatch(request, caller) }
  } catch (error) {
    if (error instanceof RpcError) return rpcError(request.id, error.code, error.message)
    throw error
  }
}
