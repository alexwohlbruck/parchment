import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { toast as sonner } from 'vue-sonner'
import { useHistoryStore } from '@/stores/history.store'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
  storedLocale: { value: 'en-US' },
}))

function counter() {
  let value = 0
  return {
    get value() {
      return value
    },
    entry: {
      label: 'bump',
      undo: () => void value--,
      redo: () => void value++,
    },
    bump() {
      value++
    },
  }
}

describe('history store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  test('undo and redo walk the recorded change back and forth', async () => {
    const history = useHistoryStore()
    const c = counter()
    c.bump()
    history.record(c.entry)

    await history.undo()
    expect(c.value).toBe(0)
    expect(history.canRedo).toBe(true)

    await history.redo()
    expect(c.value).toBe(1)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
  })

  test('a new change drops what was undone', async () => {
    const history = useHistoryStore()
    history.record(counter().entry)
    await history.undo()
    history.record(counter().entry)
    expect(history.canRedo).toBe(false)
  })

  test('changes made while undoing are not recorded again', async () => {
    const history = useHistoryStore()
    history.record({
      label: 'nested',
      undo: () => history.record(counter().entry),
      redo: () => {},
    })
    await history.undo()
    expect(history.canUndo).toBe(false)
  })

  test('a failed undo reports it and drops the change', async () => {
    const history = useHistoryStore()
    history.record({
      label: 'broken',
      undo: () => Promise.reject(new Error('offline')),
      redo: () => {},
    })
    await history.undo()
    expect(sonner.error).toHaveBeenCalled()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })

  test('the undo keys go to the newest open scope, then back to the library', async () => {
    const history = useHistoryStore()
    const c = counter()
    c.bump()
    history.record(c.entry)

    const outer = { undo: vi.fn(), redo: vi.fn() }
    const inner = { undo: vi.fn(), redo: vi.fn(), allowInInput: true }
    const releaseOuter = history.claim(outer)
    const releaseInner = history.claim(inner)

    history.undoKey()
    expect(inner.undo).toHaveBeenCalledOnce()
    expect(outer.undo).not.toHaveBeenCalled()
    expect(history.keyAllowedIn(document.createElement('input'))).toBe(true)

    releaseInner()
    history.redoKey()
    expect(outer.redo).toHaveBeenCalledOnce()
    expect(history.keyAllowedIn(document.createElement('input'))).toBe(false)

    releaseOuter()
    await history.undoKey()
    expect(c.value).toBe(0)
  })
})
