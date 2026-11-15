import { AskToolError, type AskTool } from './ask-tool-base'

const MAX_RESULTS = 5
const MAX_TOKENS = 600

const BRIEF =
  'Answer from the web in at most 120 words of plain facts: dates, times, prices, names. Say when the pages disagree or are out of date. No advice.'

const webSearch: AskTool<{ query: string }> = {
  name: 'web_search',
  description:
    "Search the web for what the map doesn't know: events and what's on, news, closures, menus and prices, opening dates, tickets. Not for finding places; their results can't be cited as places.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A full web query, with the city, e.g. "Union Square Greenmarket hours November 2026 New York"',
      },
    },
    required: ['query'],
  },
  label: () => 'Searching the web',
  detail: ({ query }) => query,
  async run({ query }, context) {
    if (!context.model) throw new AskToolError('Web search is not available here.')
    const { message, citations = [] } = await context.model.complete({
      messages: [
        { role: 'system', content: BRIEF },
        { role: 'user', content: query },
      ],
      webSearch: { maxResults: MAX_RESULTS },
      maxTokens: MAX_TOKENS,
      signal: context.signal,
    })
    for (const citation of citations) context.sources.set(citation.url, citation)
    return {
      summary: message.content?.trim() ?? '',
      count: citations.length,
      pages: citations.map(({ title, url }) => ({ title, site: siteName(url) })),
    }
  },
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const webTools: AskTool[] = [webSearch]
