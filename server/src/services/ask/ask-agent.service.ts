import type {
  ChatMessage,
  ChatToolCall,
  LanguageModelCapability,
} from '../../types/language-model.types'
import type { Place } from '../../types/place.types'
import {
  ANSWER_TOOL,
  answerTool,
  askTools,
  toChatTools,
  toolErrorMessage,
  type AskContext,
  type AskTool,
} from './ask-tools'
import { webTools } from './ask-web-tools'
import type { AskCitation, AskPoint, AskTurn, LatLng } from '../../types/ask.types'
import { classifyQuery } from '../query-intent.service'
import { HERE } from '../../lib/ask/known-places'
import { localDateTime } from '../../lib/ask/trip-summary'
import { getTimezone } from '../../lib/timezone'
import { logWarn } from '../../lib/logger'
import { foundCount } from '../../lib/ask/tool-result'

/** Model round trips per question before the answer is forced. */
export const MAX_STEPS = 10
const MAX_TOKENS = 2000
const MAX_FOLLOW_UPS = 3
const MAX_TOOL_RESULT_CHARS = 12_000

export interface AskRequest {
  question: string
  history?: AskTurn[]
  origin?: LatLng
  /** A place the question is about, looked up before the model starts. */
  placeId?: string
  point?: AskPoint
}

function subjectQuestion({ question, point }: AskRequest): string {
  if (!point) return question
  const at = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
  return `${question}\n\nThe question is about ${point.name ? `${point.name}, at ${at}` : `the spot at ${at}`}.`
}

function systemPrompt(context: AskContext): string {
  const at = context.places.get(HERE) ?? context.origin
  const zone = at ? getTimezone(at.lat, at.lng) : null
  const where = context.origin
    ? `The map is centred on ${context.origin.lat.toFixed(5)}, ${context.origin.lng.toFixed(5)}; searches look there unless given a point.`
    : 'The map position is unknown; use locate when the question names a place.'
  const named = [...context.places.keys()]
  const known = named.length
    ? `Known places, usable by name wherever a tool takes a point: ${named.join(', ')}.${context.places.has(HERE) ? ' "here" is where the user is now; use it for "from here", "near me" and trips that start now.' : ''}`
    : 'The user\'s own location is unknown, so "here" means the map position.'
  return [
    'You answer questions about places and getting around for Parchment, a maps app.',
    `It is ${localDateTime(context.now, zone)} where the user is (${zone ?? 'UTC'}). Write tool times as that local time, e.g. "2026-11-17T09:00". ${where}`,
    known,
    'Use the tools to find real places; never name a place a tool did not return.',
    'Prefer browse_category with tags for kinds of places, and get_place to check hours or reviews before recommending.',
    'Results carry openNow and hours from the map data. Trust them over anything a review or web page says.',
    'For a ride, run or walk taken for its own sake (a loop, a tour, around an island, through a park), design it yourself and save it with create_route: pick points in order along the way you mean, enough of them to hold it to the shore, greenway or bridge, ending where it started for a round trip. Then call create_canvas with that route and a layer marking the places it was built around. Say the distance and climb in the answer.',
    'Call create_canvas when the user asks for a map or canvas, or for a route as above, after finding or building what goes on it.',
    "Change the user's library only when they ask: save_place to save a place, edit_route to change a route, share_canvas for a link anyone can open, archive to file something away.",
    'Use web_search only for what the map cannot know (events, news, menus, prices, tickets, a place that just opened or closed), then find any place it mentions with the map tools before citing it.',
    'For how to get somewhere, call plan_trip, with kind when the user names a way of travelling: biking is their own bike, bikeshare only for Citi Bike and the like, never one in place of the other. A time someone must be somewhere by (work, a meeting, "monday 9am" for a commute) is arrive_by; "leave at" is depart_at. For stops on the way (water, food, a shop), find them with search_along_route, then pass the ones you pick to plan_trip as stops, so the trip goes through them. Use transit_departures for what leaves a station soon, transit_line for where a line goes and whether it is running, transit_trips only for timetables like the last train, travel_times to compare ways, and weather or wildfires when they matter.',
    `Give distances in ${context.units === 'imperial' ? 'miles and feet' : 'kilometres and metres'}, and times as the tools give them.`,
    `Finish by calling ${ANSWER_TOOL}. Keep its text to at most two short sentences, about 40 words; the cards carry the rest. For a trip, describe the first trip the tool returned (the one the app shows), with every move it makes and none presented as optional; say the moves that matter (where to pick up and drop off a bike, which line) and how long it takes; give clock times only when the user asked when, and add no caveats. The app shows a Directions button. For places, the app shows each one's distance, hours and address on a card, so never repeat them.`,
    'Never write coordinates or place ids in your text; call an unnamed place by what it is and where ("the drinking fountain on Broadway"). Never ask for something a known place already answers. If nothing fits, say what is missing and return no places.',
  ].join('\n')
}

function parseArgs(call: ChatToolCall): Record<string, any> {
  try {
    return JSON.parse(call.function.arguments || '{}')
  } catch {
    return {}
  }
}

function toolMessage(call: ChatToolCall, result: unknown): ChatMessage {
  const content = JSON.stringify(result) ?? 'null'
  return {
    role: 'tool',
    tool_call_id: call.id,
    content:
      content.length > MAX_TOOL_RESULT_CHARS
        ? `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)`
        : content,
  }
}

async function runTool(
  tool: AskTool | undefined,
  call: ChatToolCall,
  context: AskContext,
): Promise<ChatMessage> {
  if (!tool)
    return toolMessage(call, { error: `Unknown tool ${call.function.name}` })
  const args = parseArgs(call)
  const detail = tool.detail?.(args, context)
  const step = {
    id: call.id,
    tool: tool.name,
    label: tool.label(args),
    ...(detail && { detail }),
  }
  context.emit({ type: 'step', ...step, status: 'running' })
  try {
    const result = await tool.run(args, context)
    const found = foundCount(result)
    context.emit({
      type: 'step',
      ...step,
      status: 'done',
      ...(found !== undefined && { found }),
    })
    return toolMessage(call, result)
  } catch (error) {
    logWarn(
      `Ask tool ${tool.name} failed: ${error instanceof Error ? error.message : error}`,
    )
    context.emit({ type: 'step', ...step, status: 'failed' })
    return toolMessage(call, { error: toolErrorMessage(error) })
  }
}

export interface GroundedAnswer {
  text: string
  places: AskCitation[]
  followUps: string[]
  unknownIds: string[]
}

/** Keep only places a tool actually returned, so the model cannot invent one. */
export function groundAnswer(
  args: { text?: unknown; places?: unknown; follow_ups?: unknown },
  seen: Map<string, Place>,
): GroundedAnswer {
  const cited = Array.isArray(args.places) ? args.places : []
  const places: GroundedAnswer['places'] = []
  const unknownIds: string[] = []
  const used = new Set<string>()
  for (const entry of cited) {
    const id = typeof entry?.id === 'string' ? entry.id : ''
    const place = seen.get(id)
    if (!place) {
      unknownIds.push(id)
      continue
    }
    if (used.has(id)) continue
    used.add(id)
    places.push({
      place,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    })
  }
  return {
    text: typeof args.text === 'string' ? args.text.trim() : '',
    places,
    followUps: (Array.isArray(args.follow_ups) ? args.follow_ups : [])
      .filter(
        (question): question is string =>
          typeof question === 'string' && !!question.trim(),
      )
      .map((question) => question.trim())
      .slice(0, MAX_FOLLOW_UPS),
    unknownIds,
  }
}

export async function runAsk(
  model: LanguageModelCapability,
  request: AskRequest,
  context: AskContext,
): Promise<void> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(context) },
    ...(request.history ?? []),
    { role: 'user', content: subjectQuestion(request) },
  ]
  const tools = context.model ? askTools : askTools.filter((tool) => !webTools.includes(tool))
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const allTools = [...toChatTools(tools), answerTool]

  if (request.placeId) {
    const call: ChatToolCall = {
      id: 'subject-place',
      type: 'function',
      function: {
        name: 'get_place',
        arguments: JSON.stringify({ id: request.placeId }),
      },
    }
    messages.push(
      {
        role: 'assistant',
        content: 'The question is about this place.',
        tool_calls: [call],
      },
      await runTool(toolsByName.get('get_place'), call, context),
    )
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1
    const { message } = await model.complete({
      messages,
      tools: last ? [answerTool] : allTools,
      toolChoice: 'required',
      maxTokens: MAX_TOKENS,
      signal: context.signal,
    })
    messages.push(message)

    const calls = message.tool_calls ?? []
    if (!calls.length) {
      context.emit({
        type: 'answer',
        text: message.content?.trim() ?? '',
        places: [],
      })
      return
    }

    const answerCall = calls.find((call) => call.function.name === ANSWER_TOOL)
    if (answerCall) {
      const answer = groundAnswer(parseArgs(answerCall), context.seen)
      if (!answer.unknownIds.length || last) {
        if (context.proposedTrip) context.emit(context.proposedTrip)
        const intent = classifyQuery(request.question, {
          language: context.language,
        })
        context.emit({
          type: 'answer',
          text: answer.text,
          places: answer.places,
          ...(answer.followUps.length && { followUps: answer.followUps }),
          ...(context.sources.size && { sources: [...context.sources.values()] }),
          ...(intent.category ? { browse: intent } : {}),
        })
        return
      }
      messages.push(
        ...calls.map((call) =>
          toolMessage(
            call,
            call === answerCall
              ? {
                  error: `Unknown place ids ${answer.unknownIds.join(', ')}. Cite only ids returned by tools.`,
                }
              : { skipped: true },
          ),
        ),
      )
      continue
    }

    messages.push(
      ...(await Promise.all(
        calls.map((call) =>
          runTool(toolsByName.get(call.function.name), call, context),
        ),
      )),
    )
  }
}
