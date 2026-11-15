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
import type { AskCitation, AskTurn, LatLng } from '../../types/ask.types'
import { classifyQuery } from '../query-intent.service'
import { HERE } from '../../lib/ask/known-places'

/** Model round trips per question before the answer is forced. */
export const MAX_STEPS = 6
const MAX_TOKENS = 1200
const MAX_TOOL_RESULT_CHARS = 12_000

export interface AskRequest {
  question: string
  history?: AskTurn[]
  origin?: LatLng
  /** A place the question is about, looked up before the model starts. */
  placeId?: string
}

function systemPrompt(context: AskContext): string {
  const where = context.origin
    ? `The map is centred on ${context.origin.lat.toFixed(5)}, ${context.origin.lng.toFixed(5)}; searches look there unless given a point.`
    : 'The map position is unknown; use locate when the question names a place.'
  const named = [...context.places.keys()]
  const known = named.length
    ? `Known places, usable by name wherever a tool takes a point: ${named.join(', ')}.${context.places.has(HERE) ? ' "here" is where the user is now; use it for "from here", "near me" and trips that start now.' : ''}`
    : 'The user\'s own location is unknown, so "here" means the map position.'
  return [
    'You answer questions about places and getting around for Parchment, a maps app.',
    `It is ${context.now.toISOString()}. ${where}`,
    known,
    'Use the tools to find real places; never name a place a tool did not return.',
    'Prefer browse_category with tags for kinds of places, and get_place to check hours or reviews before recommending.',
    'Results carry openNow and hours from the map data. Trust them over anything a review says.',
    'For how to get somewhere, call plan_trip, with kind when the user names a way of travelling (bikeshare for Citi Bike and the like). Use transit_trips for timetables, travel_times to compare ways, and weather when it matters.',
    `Give distances in ${context.units === 'imperial' ? 'miles and feet' : 'kilometres and metres'}, and times as the tools give them.`,
    `Finish by calling ${ANSWER_TOOL}. Keep its text to one or two short sentences. For a trip, say the moves that matter (where to pick up and drop off a bike, which line, when to leave); the app shows a Directions button. For places, the app shows each one's distance, hours and address on a card, so never repeat them.`,
    'Never ask for something a known place already answers. If nothing fits, say what is missing and return no places.',
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
    content: content.length > MAX_TOOL_RESULT_CHARS
      ? `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)`
      : content,
  }
}

async function runTool(
  tool: AskTool | undefined,
  call: ChatToolCall,
  context: AskContext,
): Promise<ChatMessage> {
  if (!tool) return toolMessage(call, { error: `Unknown tool ${call.function.name}` })
  const args = parseArgs(call)
  const step = { id: call.id, label: tool.label(args) }
  context.emit({ type: 'step', ...step, status: 'running' })
  try {
    const result = await tool.run(args, context)
    context.emit({ type: 'step', ...step, status: 'done' })
    return toolMessage(call, result)
  } catch (error) {
    context.emit({ type: 'step', ...step, status: 'failed' })
    return toolMessage(call, { error: toolErrorMessage(error) })
  }
}

export interface GroundedAnswer {
  text: string
  places: AskCitation[]
  unknownIds: string[]
}

/** Keep only places a tool actually returned, so the model cannot invent one. */
export function groundAnswer(
  args: { text?: unknown; places?: unknown },
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
    places.push({ place, reason: typeof entry.reason === 'string' ? entry.reason : '' })
  }
  return {
    text: typeof args.text === 'string' ? args.text.trim() : '',
    places,
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
    { role: 'user', content: request.question },
  ]
  const toolsByName = new Map(askTools.map((tool) => [tool.name, tool]))
  const allTools = [...toChatTools(askTools), answerTool]

  if (request.placeId) {
    const call: ChatToolCall = {
      id: 'subject-place',
      type: 'function',
      function: { name: 'get_place', arguments: JSON.stringify({ id: request.placeId }) },
    }
    messages.push(
      { role: 'assistant', content: 'The question is about this place.', tool_calls: [call] },
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
      context.emit({ type: 'answer', text: message.content?.trim() ?? '', places: [] })
      return
    }

    const answerCall = calls.find((call) => call.function.name === ANSWER_TOOL)
    if (answerCall) {
      const answer = groundAnswer(parseArgs(answerCall), context.seen)
      if (!answer.unknownIds.length || last) {
        const intent = classifyQuery(request.question, { language: context.language })
        context.emit({
          type: 'answer',
          text: answer.text,
          places: answer.places,
          ...(intent.category ? { browse: intent } : {}),
        })
        return
      }
      messages.push(
        ...calls.map((call) =>
          toolMessage(call, call === answerCall
            ? { error: `Unknown place ids ${answer.unknownIds.join(', ')}. Cite only ids returned by tools.` }
            : { skipped: true }),
        ),
      )
      continue
    }

    messages.push(
      ...(await Promise.all(
        calls.map((call) => runTool(toolsByName.get(call.function.name), call, context)),
      )),
    )
  }
}
