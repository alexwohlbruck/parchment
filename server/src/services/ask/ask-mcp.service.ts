import { version } from '../../../package.json'
import { logError } from '../../lib/logger'
import { askTools, toolErrorMessage, type AskContext } from './ask-tools'
import { webTools } from './ask-web-tools'
import type { Language } from '../../lib/i18n/i18n.types'
import type { AskEndpoint, AskUnits, LatLng } from '../../types/ask.types'
import type { Vehicle, VehicleType } from '../../types/trip.types'
import { getAskPreferences, getUserPreferences } from '../user-preferences.service'
import { getActiveVehicles } from '../vehicle.service'
import { getFrequentBookmarks } from '../library/bookmarks.service'
import { knownPlaces } from '../../lib/ask/known-places'
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
  'Search Parchment for real places, search along a route, and plan how to reach them: trips with stops, live transit departures, lines and alerts, travel times by mode, bike share availability, weather, air quality and wildfires, and what is at a point. Build, change and archive routes (rides, runs and walks through points you choose) and canvases (maps of routes, places and travel-time areas) in the user\'s library, share a canvas by link, save places to their collections, and read their saved places, collections, routes, canvases and vehicles. Change the library only when the user asks. Tools need a location: pass coordinates, a place id a tool returned, a place name, or one of the user\'s saved places by name ("home", "work"). Times are local to the trip.'

/** MCP clients search the web themselves, and Parchment has no model to do it with here. */
const mcpTools = askTools.filter((tool) => !webTools.includes(tool))
const toolsByName = new Map(mcpTools.map((tool) => [tool.name, tool]))

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

export function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function listMcpTools(): McpTool[] {
  return mcpTools.map(({ name, description, parameters }) => ({
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

/** What the app sends with each question, read from the user's own account instead. */
async function userContext(userId: string): Promise<Pick<AskContext, 'places' | 'units' | 'vehicles'>> {
  const [preferences, askPreferences, vehicles, frequents] = await Promise.all([
    getUserPreferences(userId),
    getAskPreferences(userId),
    getActiveVehicles(userId),
    getFrequentBookmarks(userId),
  ])
  const saved: AskEndpoint[] = frequents.map((bookmark) => ({
    name: bookmark.frequentType === 'custom' ? bookmark.name : bookmark.frequentType!,
    lat: bookmark.lat,
    lng: bookmark.lng,
  }))
  return {
    places: askPreferences.shareLocation ? knownPlaces(undefined, saved) : new Map(),
    units: (preferences?.unitSystem as AskUnits | undefined) ?? 'metric',
    vehicles: vehicles.map(
      (vehicle): Vehicle => ({
        id: vehicle.id,
        type: vehicle.type as VehicleType,
        ...(vehicle.name && { name: vehicle.name }),
        ...(vehicle.lastKnownLat != null && vehicle.lastKnownLng != null && {
          location: { lat: vehicle.lastKnownLat, lng: vehicle.lastKnownLng },
        }),
      }),
    ),
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
    origin: [args.near, args.from, args.at].find((point): point is LatLng => typeof point === 'object' && point !== null),
    ...(await userContext(caller.userId)),
    routes: new Map(),
    now: new Date(),
    signal: caller.signal,
    seen: new Map<string, Place>(),
    reviews: new Map(),
    sources: new Map(),
    emit: () => {},
  }

  try {
    const result = await tool.run(args, context)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (error) {
    logError(`MCP tool ${tool.name} failed`, error)
    return { content: [{ type: 'text', text: toolErrorMessage(error) }], isError: true }
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
