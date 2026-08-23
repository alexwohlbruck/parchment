import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useCanvasHistory } from './useCanvasHistory'
import type { CanvasBody } from '@/types/canvas.types'

/**
 * Undo is judged by what the document reads as afterwards, not by how the
 * stack is shaped — so these drive it the way the editor does: change the
 * body, wait for the step to be recorded, then step back and forth.
 */

function history(initial: CanvasBody = { layers: [], annotations: [] }) {
  const body = ref<CanvasBody>(initial)
  const scope = effectScope()
  const api = scope.run(() => useCanvasHistory(body))!
  return { ...api, body, dispose: () => scope.stop() }
}

/** Let the debounced record run, as the editor's idle moment would. */
async function settle() {
  await nextTick()
  await vi.advanceTimersByTimeAsync(1)
}

/** Move past the window in which edits merge into one step. */
async function pause() {
  await vi.advanceTimersByTimeAsync(600)
}

function withPin(body: CanvasBody, id: string): CanvasBody {
  return {
    ...body,
    annotations: [
      ...(body.annotations ?? []),
      { id, tool: 'pin', positions: [[0, 0]] },
    ],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useCanvasHistory', () => {
  it('has nothing to undo until something changes', async () => {
    const editor = history()
    await settle()
    expect(editor.canUndo.value).toBe(false)
    expect(editor.canRedo.value).toBe(false)
    editor.dispose()
  })

  it('steps back to the document as it was', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await settle()

    expect(editor.canUndo.value).toBe(true)
    editor.undo()

    expect(editor.body.value.annotations).toEqual([])
    editor.dispose()
  })

  it('steps forward again', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await settle()

    editor.undo()
    expect(editor.canRedo.value).toBe(true)
    editor.redo()

    expect(editor.body.value.annotations).toHaveLength(1)
    expect(editor.canRedo.value).toBe(false)
    editor.dispose()
  })

  it('undoes an edit that has only just happened', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await nextTick()

    // No idle moment: the step has not been recorded yet, and undo still has
    // to work — this is the reflex right after a mistake.
    editor.undo()

    expect(editor.body.value.annotations).toEqual([])
    editor.dispose()
  })

  it('walks back through separate edits one at a time', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await settle()
    await pause()
    editor.body.value = withPin(editor.body.value, 'b')
    await settle()

    editor.undo()
    expect(editor.body.value.annotations?.map(a => a.id)).toEqual(['a'])
    editor.undo()
    expect(editor.body.value.annotations).toEqual([])
    editor.dispose()
  })

  it('merges a burst of edits into one step', async () => {
    const editor = history()
    // Typing a name is many changes and one thing done.
    for (const id of ['a', 'b', 'c']) {
      editor.body.value = withPin(editor.body.value, id)
      await settle()
    }

    editor.undo()

    expect(editor.body.value.annotations).toEqual([])
    expect(editor.canUndo.value).toBe(false)
    editor.dispose()
  })

  it('drops the redo stack once you edit from where you stepped back to', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await settle()
    editor.undo()
    expect(editor.canRedo.value).toBe(true)

    await pause()
    editor.body.value = withPin(editor.body.value, 'z')
    await settle()

    expect(editor.canRedo.value).toBe(false)
    editor.dispose()
  })

  it('does not record its own writing', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await settle()

    editor.undo()
    await settle()

    // Undo must not become the thing the next undo steps back from.
    expect(editor.canUndo.value).toBe(false)
    expect(editor.body.value.annotations).toEqual([])
    editor.dispose()
  })

  it('forgets everything when another canvas is loaded', async () => {
    const editor = history()
    editor.body.value = withPin(editor.body.value, 'a')
    await settle()

    editor.reset()

    expect(editor.canUndo.value).toBe(false)
    expect(editor.canRedo.value).toBe(false)
    editor.dispose()
  })
})
