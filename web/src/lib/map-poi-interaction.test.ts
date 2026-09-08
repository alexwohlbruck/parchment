import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MapPoiClickPolicy,
  POI_DOUBLE_TAP_MS,
  PoiTapController,
} from './map-poi-interaction'

function touchEvent(
  type: string,
  timeStamp: number,
  points: Array<{ x: number; y: number }>,
) {
  const event = new Event(type)
  Object.defineProperties(event, {
    timeStamp: { value: timeStamp },
    touches: {
      value: points.map((point, identifier) => ({
        identifier,
        clientX: point.x,
        clientY: point.y,
      })),
    },
  })
  return event
}

function clickEvent(timeStamp: number) {
  const event = new Event('click')
  Object.defineProperties(event, {
    timeStamp: { value: timeStamp },
    sourceCapabilities: { value: { firesTouchEvents: true } },
  })
  return event
}

function tap(element: HTMLElement, start: number, x = 20, y = 30) {
  element.dispatchEvent(touchEvent('touchstart', start, [{ x, y }]))
  element.dispatchEvent(touchEvent('touchend', start + 20, []))
}

function setup() {
  const element = document.createElement('div')
  const policy = new MapPoiClickPolicy()
  const controller = new PoiTapController(element, policy)
  return { element, policy, controller }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PoiTapController', () => {
  it('keeps mouse POI clicks immediate', () => {
    const { controller } = setup()
    const action = vi.fn()
    const prefetch = vi.fn()

    controller.handle(
      { point: { x: 20, y: 30 }, originalEvent: new Event('click') },
      action,
      prefetch,
    )

    expect(action).toHaveBeenCalledOnce()
    expect(prefetch).not.toHaveBeenCalled()
    controller.destroy()
  })

  it('prefetches on the first tap and commits after the gesture window', () => {
    vi.useFakeTimers()
    const { element, controller } = setup()
    const action = vi.fn()
    const prefetch = vi.fn()
    tap(element, 0)

    controller.handle(
      { point: { x: 20, y: 30 }, originalEvent: clickEvent(21) },
      action,
      prefetch,
    )

    expect(prefetch).toHaveBeenCalledOnce()
    expect(action).not.toHaveBeenCalled()
    vi.advanceTimersByTime(POI_DOUBLE_TAP_MS)
    expect(action).toHaveBeenCalledOnce()
    controller.destroy()
  })

  it('cancels a POI action when a nearby second tap begins', () => {
    vi.useFakeTimers()
    const { element, controller } = setup()
    const action = vi.fn()
    tap(element, 0)
    controller.handle(
      { point: { x: 20, y: 30 }, originalEvent: clickEvent(21) },
      action,
    )

    element.dispatchEvent(touchEvent('touchstart', 100, [{ x: 22, y: 29 }]))
    element.dispatchEvent(touchEvent('touchend', 130, []))
    controller.handle(
      { point: { x: 22, y: 29 }, originalEvent: clickEvent(131) },
      action,
    )
    vi.advanceTimersByTime(POI_DOUBLE_TAP_MS * 2)

    expect(action).not.toHaveBeenCalled()
    controller.destroy()
  })

  it('cancels a POI action for double-tap-and-drag zoom', () => {
    vi.useFakeTimers()
    const { element, controller } = setup()
    const action = vi.fn()
    tap(element, 0)
    controller.handle(
      { point: { x: 20, y: 30 }, originalEvent: clickEvent(21) },
      action,
    )

    element.dispatchEvent(touchEvent('touchstart', 100, [{ x: 20, y: 30 }]))
    element.dispatchEvent(touchEvent('touchmove', 120, [{ x: 20, y: 80 }]))
    element.dispatchEvent(touchEvent('touchend', 160, []))
    vi.advanceTimersByTime(POI_DOUBLE_TAP_MS * 2)

    expect(action).not.toHaveBeenCalled()
    controller.destroy()
  })

  it('leaves generic map handling available while POIs are suppressed', () => {
    const { policy, controller } = setup()
    const action = vi.fn()
    const release = policy.suppress()

    expect(controller.handle({ point: { x: 1, y: 1 } }, action)).toBe(false)
    expect(action).not.toHaveBeenCalled()

    release()
    expect(controller.handle({ point: { x: 1, y: 1 } }, action)).toBe(true)
    expect(action).toHaveBeenCalledOnce()
    controller.destroy()
  })

  it('cancels a retained tap when a consumer suppresses POIs', () => {
    vi.useFakeTimers()
    const { element, policy, controller } = setup()
    const action = vi.fn()
    tap(element, 0)
    controller.handle(
      { point: { x: 20, y: 30 }, originalEvent: clickEvent(21) },
      action,
    )

    policy.suppress()
    vi.advanceTimersByTime(POI_DOUBLE_TAP_MS)

    expect(action).not.toHaveBeenCalled()
    controller.destroy()
  })
})

describe('MapPoiClickPolicy', () => {
  it('requires every nested consumer to release its suppression', () => {
    const policy = new MapPoiClickPolicy()
    const releaseEditor = policy.suppress()
    const releaseTool = policy.suppress()

    releaseEditor()
    expect(policy.enabled).toBe(false)
    releaseTool()
    expect(policy.enabled).toBe(true)
  })
})
