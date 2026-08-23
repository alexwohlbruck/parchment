import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useCanvasHistory } from './useCanvasHistory'
import type { CanvasBody } from '@/types/canvas.types'

/**
 * Undo is judged by what the document reads as afterwards, not by how the
 * stack is shaped — so these drive it the way the editor does: change the
 * body, wait for the step to be recorded, then step back and forth.
 */

/**
 * The editor's state is a body plus whatever is half-drawn, and the stack
 * covers both — so these drive both and check that stepping back crosses
 * between them without noticing.
 */
interface Drawing {
  positions: number[][]
}

function history(initial: CanvasBody = { layers: [], annotations: [] }) {
  const body = ref<CanvasBody>(initial)
  const drawing = ref<Drawing>({ positions: [] })
  const busy = ref(false)
  const scope = effectScope()
  const api = scope.run(() =>
    useCanvasHistory({
      snapshot: () => ({ body: body.value, drawing: drawing.value }),
      restore: snapshot => {
        body.value = snapshot.body
        drawing.value = snapshot.drawing
      },
      busy,
    }),
  )!
  return { ...api, body, drawing, busy, dispose: () => scope.stop() }
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

describe('useCanvasHistory across the whole editor', () => {
  it('steps back over a finished shape, then over the points that made it', async () => {
    const editor = history()

    // Two points placed, then the shape committed — the shape moves from the
    // drawing state into the body, which used to be where undo gave up.
    editor.drawing.value = { positions: [[0, 0]] }
    await settle()
    await pause()
    editor.drawing.value = { positions: [[0, 0], [1, 1]] }
    await settle()
    await pause()
    editor.body.value = withPin(editor.body.value, 'shape')
    editor.drawing.value = { positions: [] }
    await settle()

    editor.undo()
    expect(editor.body.value.annotations).toEqual([])
    expect(editor.drawing.value.positions).toHaveLength(2)

    // And straight on into the points, without changing stack.
    editor.undo()
    expect(editor.drawing.value.positions).toHaveLength(1)
    editor.undo()
    expect(editor.drawing.value.positions).toEqual([])
    editor.dispose()
  })

  it('redoes back across the same boundary', async () => {
    const editor = history()
    editor.drawing.value = { positions: [[0, 0], [1, 1]] }
    await settle()
    await pause()
    editor.body.value = withPin(editor.body.value, 'shape')
    editor.drawing.value = { positions: [] }
    await settle()

    editor.undo()
    editor.redo()

    expect(editor.body.value.annotations).toHaveLength(1)
    expect(editor.drawing.value.positions).toEqual([])
    editor.dispose()
  })

  it('keeps deliberate clicks apart however fast they come', async () => {
    const editor = history()
    // 300ms apart: quick, but two decisions rather than one gesture.
    for (const positions of [[[0, 0]], [[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]]]) {
      editor.drawing.value = { positions }
      await settle()
      await vi.advanceTimersByTimeAsync(300)
    }

    editor.undo()
    expect(editor.drawing.value.positions).toHaveLength(2)
    editor.undo()
    expect(editor.drawing.value.positions).toHaveLength(1)
    editor.dispose()
  })

  it('collapses a continuous gesture into one step', async () => {
    const editor = history()
    // A slider at sixty frames a second, for a second.
    for (let i = 1; i <= 60; i++) {
      editor.body.value = { ...editor.body.value, camera: { zoom: i } as never }
      await settle()
      await vi.advanceTimersByTimeAsync(16)
    }

    editor.undo()

    expect(editor.body.value.camera).toBeUndefined()
    expect(editor.canUndo.value).toBe(false)
    editor.dispose()
  })

  it('records nothing while a stroke is still being drawn', async () => {
    const editor = history()
    editor.busy.value = true
    for (let i = 1; i <= 50; i++) {
      editor.drawing.value = { positions: Array.from({ length: i }, () => [0, 0]) }
      await settle()
      await vi.advanceTimersByTimeAsync(16)
    }
    expect(editor.canUndo.value).toBe(false)

    // The stroke lands as one thing when the pointer lifts.
    editor.busy.value = false
    editor.body.value = withPin(editor.body.value, 'stroke')
    editor.drawing.value = { positions: [] }
    await settle()

    editor.undo()
    expect(editor.body.value.annotations).toEqual([])
    editor.dispose()
  })
})
