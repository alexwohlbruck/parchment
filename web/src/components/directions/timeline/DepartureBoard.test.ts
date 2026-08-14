import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DepartureBoard, { type BoardCard } from './DepartureBoard.vue'

/**
 * These assert the board's *visual language*, not its pixels — each channel
 * answers one question and never borrows another's. The rules are easy to
 * erode one convenient exception at a time, so they're pinned here.
 */

function card(overrides: Partial<BoardCard['card']> = {}, ms = 1_000): BoardCard {
  return {
    ms,
    route: { shortName: '4', color: '00933C', textColor: 'FFFFFF' },
    card: { lead: '5 min', sub: '2:24', clickable: true, ...overrides },
  }
}

function mountBoard(cards: BoardCard[]) {
  return mount(DepartureBoard, { props: { cards, lineName: '4' } })
}

/** The chip element for card `i`. */
function chip(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return wrapper.findAll('button')[i]
}

/** The countdown — the hero line, and the one that carries status colour. */
function countdown(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return chip(wrapper, i).get('[data-testid="countdown"]')
}

/** The single footnote slot: status word, else timetable pair, else clock. */
function footnote(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return chip(wrapper, i).get('[data-testid="footnote"]')
}

function bullet(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return chip(wrapper, i).get('.route-bullet')
}

describe('status wording', () => {
  it('says nothing on a comfortable run — just the clock', () => {
    const w = mountBoard([card()])
    expect(footnote(w).text()).toBe('2:24')
  })

  it('labels a tight run "hurry" and a likely-missed one "may miss"', () => {
    const w = mountBoard([card({ hurry: true }), card({ unreachable: true }, 2_000)])
    expect(footnote(w, 0).text()).toBe('hurry')
    expect(footnote(w, 1).text()).toBe('may miss')
  })

  it('shows only the worst news — cancelled outranks the rest', () => {
    const w = mountBoard([card({ cancelled: true, unreachable: true, hurry: true })])
    expect(footnote(w).text()).toBe('cancelled')
  })

  it('ranks "may miss" above "hurry" when both somehow apply', () => {
    const w = mountBoard([card({ unreachable: true, hurry: true })])
    expect(footnote(w).text()).toBe('may miss')
  })

  it('leaves a departed run wordless — "3m ago" already says it', () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' })])
    expect(footnote(w).text()).toBe('2:24')
  })
})

describe('the countdown carries the status colour, so nothing out-shouts it', () => {
  it('tints the countdown itself rather than adding a louder badge', () => {
    const w = mountBoard([card({ hurry: true }), card({ unreachable: true }, 2_000)])
    expect(countdown(w, 0).classes().join(' ')).toContain('amber')
    expect(countdown(w, 1).classes().join(' ')).toContain('orange')
  })

  it('resolves one colour at a time, never two competing', () => {
    // Two text-colour classes on one element would race on stylesheet order.
    const w = mountBoard([card({ unreachable: true, hurry: true, arriving: true })])
    const colours = countdown(w)
      .classes()
      .filter(c => c.startsWith('text-') && !c.startsWith('text-['))
    expect(colours).toHaveLength(1)
  })
})

describe('receding separates operator facts from our estimates', () => {
  it('mutes a departed or cancelled run — it genuinely is not an option', () => {
    const w = mountBoard([card({ departed: true }), card({ cancelled: true }, 2_000)])
    expect(countdown(w, 0).classes().join(' ')).toContain('muted-foreground')
    expect(countdown(w, 1).classes().join(' ')).toContain('muted-foreground')
    // The bullet fades on its own; a blanket card opacity would desaturate
    // the line colour into mud.
    expect(bullet(w, 0).classes()).toContain('opacity-45')
    expect(bullet(w, 1).classes()).toContain('opacity-45')
  })

  it('never mutes a run we merely estimated you would miss', () => {
    // The whole point of the reachability work: our guess must not make a
    // run look unavailable, because the rider is often closer than we think.
    const w = mountBoard([card({ unreachable: true }), card({ hurry: true }, 2_000)])
    for (const i of [0, 1]) {
      expect(countdown(w, i).classes().join(' ')).not.toContain('muted-foreground')
      expect(bullet(w, i).classes()).not.toContain('opacity-45')
    }
  })
})

describe('the board keeps one rhythm', () => {
  it('gives every chip the same width, whatever its status', () => {
    const w = mountBoard([
      card(),
      card({ hurry: true }, 2_000),
      card({ unreachable: true }, 3_000),
      card({ cancelled: true }, 4_000),
      card({ departed: true, lead: '3m ago' }, 5_000),
    ])
    for (let i = 0; i < 5; i++) {
      expect(chip(w, i).classes()).toContain('w-[78px]')
    }
  })

  it('keeps the footnote to a single line — status replaces the clock', () => {
    const w = mountBoard([card({ hurry: true, sub: '2:24', scheduledSub: '2:21' })])
    expect(footnote(w).text()).toBe('hurry')
  })
})

describe('strikethrough means void or superseded, nothing else', () => {
  it('strikes a cancelled run\'s countdown', () => {
    const w = mountBoard([card({ cancelled: true })])
    expect(countdown(w).classes()).toContain('line-through')
  })

  it('does not strike a departed run — it happened, it is not void', () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' })])
    expect(chip(w).html()).not.toContain('line-through')
  })

  it('strikes only the timetable time it beat when running late', () => {
    const w = mountBoard([card({ scheduledSub: '2:21', sub: '2:24', delaySec: 180 })])
    expect(countdown(w).classes()).not.toContain('line-through')
    expect(footnote(w).html()).toMatch(/line-through[^>]*>2:21/)
    expect(footnote(w).text()).toContain('2:24')
  })
})

describe('selection owns the border, and only the border', () => {
  it('rings the planned run', () => {
    const w = mountBoard([card({ planned: true })])
    expect(chip(w).classes()).toContain('border-parchment-500')
  })

  it('leaves every other run a transparent border, so nothing shifts', () => {
    const w = mountBoard([card(), card({ hurry: true }, 2_000), card({ departed: true }, 3_000)])
    for (let i = 0; i < 3; i++) {
      expect(chip(w, i).classes()).toContain('border-transparent')
    }
  })

  it('still rings, and still mutes, a planned run that has departed', () => {
    // The two channels are independent — neither suppresses the other.
    const w = mountBoard([card({ planned: true, departed: true, lead: '1m ago' })])
    expect(chip(w).classes()).toContain('border-parchment-500')
    expect(countdown(w).classes().join(' ')).toContain('muted-foreground')
  })

  it('rings without tinting the fill, so a selected run never reads as an error', () => {
    const w = mountBoard([card({ planned: true })])
    expect(chip(w).classes()).toContain('bg-muted/40')
    expect(chip(w).attributes('style') ?? '').not.toContain('background')
  })
})

describe('selection', () => {
  it('emits the chosen run', async () => {
    const w = mountBoard([card({}, 4_242)])
    await chip(w).trigger('click')
    expect(w.emitted('choose')?.[0]).toEqual([4_242])
  })

  it('lets the rider pick a run we think they will miss', async () => {
    const w = mountBoard([card({ unreachable: true }, 7_000)])
    await chip(w).trigger('click')
    expect(w.emitted('choose')?.[0]).toEqual([7_000])
  })

  it('lets the rider pick one that already departed', async () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' }, 8_000)])
    await chip(w).trigger('click')
    expect(w.emitted('choose')?.[0]).toEqual([8_000])
  })

  it('no chip is ever disabled', () => {
    const w = mountBoard([
      card({ departed: true }),
      card({ cancelled: true }, 2_000),
      card({ unreachable: true }, 3_000),
    ])
    expect(w.findAll('button[disabled]')).toHaveLength(0)
  })

  it('does not re-emit for the run already selected', async () => {
    const w = mountBoard([card({ planned: true, clickable: false })])
    await chip(w).trigger('click')
    expect(w.emitted('choose')).toBeUndefined()
  })
})
