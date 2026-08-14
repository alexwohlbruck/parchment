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

describe('badges', () => {
  it('shows nothing on a comfortable run', () => {
    const w = mountBoard([card()])
    expect(chip(w).text()).not.toMatch(/hurry|may miss|cancelled/)
  })

  it('labels a tight run "hurry" and a likely-missed one "may miss"', () => {
    const w = mountBoard([card({ hurry: true }), card({ unreachable: true }, 2_000)])
    expect(chip(w, 0).text()).toContain('hurry')
    expect(chip(w, 1).text()).toContain('may miss')
  })

  it('shows only the worst news — cancelled outranks the rest', () => {
    const w = mountBoard([card({ cancelled: true, unreachable: true, hurry: true })])
    const text = chip(w).text()
    expect(text).toContain('cancelled')
    expect(text).not.toContain('may miss')
    expect(text).not.toContain('hurry')
  })

  it('ranks "may miss" above "hurry" when both somehow apply', () => {
    const w = mountBoard([card({ unreachable: true, hurry: true })])
    expect(chip(w).text()).toContain('may miss')
    expect(chip(w).text()).not.toContain('hurry')
  })
})

describe('dimming separates operator facts from our estimates', () => {
  it('dims a departed or cancelled run — it genuinely is not an option', () => {
    const w = mountBoard([card({ departed: true }), card({ cancelled: true }, 2_000)])
    expect(chip(w, 0).classes()).toContain('opacity-45')
    expect(chip(w, 1).classes()).toContain('opacity-45')
  })

  it('never dims a run we merely estimated you would miss', () => {
    // The whole point of the reachability work: our guess must not make a
    // run look unavailable, because the rider is often closer than we think.
    const w = mountBoard([card({ unreachable: true }), card({ hurry: true }, 2_000)])
    expect(chip(w, 0).classes()).not.toContain('opacity-45')
    expect(chip(w, 1).classes()).not.toContain('opacity-45')
  })
})

describe('strikethrough means void or superseded, nothing else', () => {
  it('strikes a cancelled run\'s countdown', () => {
    const w = mountBoard([card({ cancelled: true })])
    expect(chip(w).html()).toMatch(/line-through[^>]*>\s*5 min/)
  })

  it('does not strike a departed run — it happened, it is not void', () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' })])
    expect(chip(w).html()).not.toContain('line-through')
  })

  it('strikes only the timetable time it beat when running late', () => {
    const w = mountBoard([card({ scheduledSub: '2:21', sub: '2:24', delaySec: 180 })])
    const html = chip(w).html()
    expect(html).toMatch(/line-through[^>]*>2:21/)
    expect(html).toContain('2:24')
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

  it('still rings, and still dims, a planned run that has departed', () => {
    // The two channels are independent — neither suppresses the other.
    const w = mountBoard([card({ planned: true, departed: true })])
    expect(chip(w).classes()).toContain('border-parchment-500')
    expect(chip(w).classes()).toContain('opacity-45')
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
