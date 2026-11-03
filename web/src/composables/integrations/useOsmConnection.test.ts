import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useOsmConnection } from './useOsmConnection'

const mocks = vi.hoisted(() => ({ get: vi.fn(), configured: vi.fn(), available: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: mocks.get } }))
vi.mock('@/lib/toast', () => ({ toast: { success: mocks.success, error: mocks.error, info: vi.fn() } }))
vi.mock('@/services/integration.service', () => ({ useIntegrationService: () => ({ fetchConfiguredIntegrations: mocks.configured, fetchAvailableIntegrations: mocks.available }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let channel: { onmessage?: (event: any) => Promise<void>; close: ReturnType<typeof vi.fn> }
function setup() {
  let connection!: ReturnType<typeof useOsmConnection>
  const wrapper = mount(defineComponent({ setup() { connection = useOsmConnection(); return () => null } }))
  return { connection, wrapper }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.spyOn(globalThis, 'clearInterval')
  vi.stubGlobal('BroadcastChannel', class {
    close = vi.fn()
    constructor() { channel = this }
  })
  vi.spyOn(window, 'open').mockReturnValue({ closed: false, close: vi.fn(), location: { href: '' } } as any)
  mocks.get.mockResolvedValue({ data: { url: 'https://www.openstreetmap.org/oauth2/authorize' } })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('refreshes integrations on success and cleans up listeners', async () => {
  const { connection, wrapper } = setup()
  await connection.connect()
  expect(mocks.get).toHaveBeenCalledWith('/integrations/osm/authorize')
  await channel.onmessage?.({ data: { type: 'osm-oauth-callback', status: 'connected' } })
  expect(mocks.success).toHaveBeenCalledOnce()
  expect(mocks.configured).toHaveBeenCalledOnce()
  expect(mocks.available).toHaveBeenCalledOnce()
  expect(channel.close).toHaveBeenCalledOnce()
  wrapper.unmount()
  expect(clearInterval).toHaveBeenCalled()
})
test('reports denied authorization without marking the account connected', async () => {
  const { connection, wrapper } = setup()
  await connection.connect()
  await channel.onmessage?.({ data: { type: 'osm-oauth-callback', status: 'error', message: 'Denied' } })
  expect(mocks.error).toHaveBeenCalledWith('Denied')
  expect(mocks.configured).not.toHaveBeenCalled()
  wrapper.unmount()
})
test('allows retry after an authorization request fails', async () => {
  const { connection, wrapper } = setup()
  mocks.get.mockRejectedValueOnce(new Error('Offline'))
  await connection.connect()
  expect(connection.connecting.value).toBe(false)
  expect(mocks.error).toHaveBeenCalledOnce()
  await connection.connect()
  expect(window.open).toHaveBeenCalledTimes(2)
  wrapper.unmount()
  expect(channel.close).toHaveBeenCalledOnce()
  expect(clearInterval).toHaveBeenCalled()
})

test('explains blocked popups without starting authorization', async () => {
  const { connection, wrapper } = setup()
  vi.mocked(window.open).mockReturnValueOnce(null)
  await connection.connect()
  expect(mocks.get).not.toHaveBeenCalled()
  expect(mocks.error).toHaveBeenCalledWith('onboarding.openstreetmap.popupBlocked')
  wrapper.unmount()
})
