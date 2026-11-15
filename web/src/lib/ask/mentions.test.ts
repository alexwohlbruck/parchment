import { describe, it, expect } from 'vitest'
import { splitMentions } from './mentions'

describe('splitMentions', () => {
  it('marks the first mention of each cited place', () => {
    expect(splitMentions("Try Joe's Pizza, or Joe's Pizza Express nearby.", ["Joe's Pizza", "Joe's Pizza Express"])).toEqual([
      { text: 'Try ' },
      { text: "Joe's Pizza", mention: 0 },
      { text: ', or ' },
      { text: "Joe's Pizza Express", mention: 1 },
      { text: ' nearby.' },
    ])
  })

  it('leaves text alone when nothing is mentioned', () => {
    expect(splitMentions('Nothing fits.', ['Cafe Lalo'])).toEqual([{ text: 'Nothing fits.' }])
  })
})
