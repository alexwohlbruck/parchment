import { describe, test, expect } from 'bun:test'
import { loadWhatFreeWords, parseWhat3words } from '.'

const w3w = await loadWhatFreeWords()

describe('parseWhat3words', () => {
  test('reads the shapes a three-word address is shared in', () => {
    for (const query of [
      '///filled.count.soap',
      'filled.count.soap',
      ' ///Filled.Count.Soap ',
      'https://w3w.co/filled.count.soap',
      'https://what3words.com/filled.count.soap',
      'filled。count。soap',
    ]) {
      expect(parseWhat3words(query)).toBe('filled.count.soap')
    }
  })

  test('ignores anything that is not three words', () => {
    for (const query of ['filled.count', 'filled count soap', '///filled.count.soap.x', '1.2.3', '40.7, -73.9']) {
      expect(parseWhat3words(query)).toBeNull()
    }
  })
})

describe('WhatFreeWords', () => {
  // Published by what3words (their docs' examples) and WhatFreeWords.
  const KNOWN = [
    ['filled.count.soap', 51.520847, -0.195521],
    ['index.home.raft', 51.521251, -0.203586],
    ['joyful.nail.harmonica', 37.234328, -115.806657],
  ] as const

  test('matches published addresses in both directions', () => {
    for (const [words, lat, lng] of KNOWN) {
      expect(w3w.wordsToLatLng(words)).toEqual({ lat, lng })
      expect(w3w.latLngToWords(lat, lng)).toBe(words)
    }
  })

  test('round-trips points across the grid', () => {
    for (let i = 0; i < 2000; i++) {
      const lat = ((i * 7919) % 17000) / 100 - 85
      const lng = ((i * 104729) % 36000) / 100 - 180
      const words = w3w.latLngToWords(lat, lng)
      if (!words) continue
      const back = w3w.wordsToLatLng(words)!
      // Squares are 3 m: within 0.00003° of latitude, wider in longitude.
      expect(Math.abs(back.lat - lat)).toBeLessThan(0.00003)
      expect(w3w.latLngToWords(back.lat, back.lng)).toBe(words)
    }
  })

  test('answers null for words not on the list and points off the grid', () => {
    expect(w3w.wordsToLatLng('maps.google.com')).toBeNull()
    expect(w3w.wordsToLatLng('filled.count')).toBeNull()
    expect(w3w.latLngToWords(91, 0)).toBeNull()
  })
})
