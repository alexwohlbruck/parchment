/**
 * Modifier labels are wrong on the wrong platform: a Windows user shown ⌘,
 * for "open settings" has no key to press. Detection has to survive both the
 * deprecated `navigator.platform` and the newer `userAgentData.platform`,
 * which report macOS as "MacIntel" and "macOS" respectively.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { isApplePlatform } from './platform'

function stubNavigator(nav: Partial<Navigator> & { userAgentData?: unknown }) {
  vi.stubGlobal('navigator', nav)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isApplePlatform', () => {
  it('detects macOS from userAgentData', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' }, platform: '' })
    expect(isApplePlatform()).toBe(true)
  })

  it('detects macOS from the legacy platform string', () => {
    stubNavigator({ platform: 'MacIntel' })
    expect(isApplePlatform()).toBe(true)
  })

  it('detects iOS devices', () => {
    stubNavigator({ platform: 'iPhone' })
    expect(isApplePlatform()).toBe(true)
  })

  it('returns false on Windows and Linux', () => {
    stubNavigator({ platform: 'Win32' })
    expect(isApplePlatform()).toBe(false)

    stubNavigator({ platform: 'Linux x86_64' })
    expect(isApplePlatform()).toBe(false)
  })

  it('falls back to the user agent when platform is empty', () => {
    stubNavigator({
      platform: '',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(isApplePlatform()).toBe(true)
  })
})
