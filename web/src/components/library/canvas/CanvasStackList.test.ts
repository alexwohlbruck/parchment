import { describe, it, expect } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CanvasStackList from './CanvasStackList.vue'
import CanvasGroupRow from './CanvasGroupRow.vue'
import { CANVAS_STACK, type CanvasStackContext } from './canvas-stack-context'
import type { StackEntry } from '@/lib/canvas-stack'
import en from '@/lib/i18n/en-US.json'
import type { CanvasAnnotation, CanvasLayer } from '@/types/canvas.types'

/**
 * The stack panel renders itself inside every group, so the things worth
 * pinning are that the recursion actually happens — a group inside a group
 * gets a row of its own, at any depth — and that the destination control on
 * each of those rows aims at the group it sits on rather than the outermost.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': en },
})

/** Sortable is machinery; this test is about what it is handed to render. */
const DraggableStub = defineComponent({
  name: 'draggable',
  props: { modelValue: { type: Array, default: () => [] } },
  template: `<div><template v-for="(element, i) in modelValue" :key="i">
    <slot name="item" :element="element" :index="i" />
  </template></div>`,
})

const RowStub = defineComponent({ template: '<div class="row" />' })

const layer = (id: string): StackEntry => ({
  kind: 'layer',
  id,
  layer: { id, kind: 'style', name: id, visible: true } as CanvasLayer,
})

const group = (id: string, name: string, children: StackEntry[]): StackEntry => ({
  kind: 'group',
  id,
  group: { id, name, visible: true, children: children.map(c => c.id) },
  children,
})

function render(entries: StackEntry[]) {
  const activeGroupId = ref<string | null>(null)
  const context: CanvasStackContext = {
    layerProps: item => ({
      layer: item.layer,
      selected: false,
      onSelect: () => {},
      onToggle: () => {},
      onEdit: () => {},
      onRemove: () => {},
    }),
    annotationProps: item => ({
      annotation: item.annotation as CanvasAnnotation,
      expanded: false,
      onToggleExpanded: () => {},
      onUpdate: () => {},
      onRemove: () => {},
      onZoomTo: () => {},
    }),
    isActiveGroup: id => activeGroupId.value === id,
    setActiveGroup: id => (activeGroupId.value = id),
    patchGroup: () => {},
    removeGroup: () => {},
    onChange: () => {},
  }

  const wrapper = mount(CanvasStackList, {
    props: { entries },
    global: {
      plugins: [i18n],
      provide: { [CANVAS_STACK as symbol]: context },
      stubs: {
        draggable: DraggableStub,
        CanvasLayerRow: RowStub,
        CanvasAnnotationRow: RowStub,
      },
    },
  })

  return { wrapper, activeGroupId }
}

/** The destination toggle, in whichever state it is currently in. */
function destinationButtons(wrapper: ReturnType<typeof render>['wrapper']) {
  return wrapper
    .findAll('button')
    .filter(button =>
      ['File new marks here', 'New marks land here'].includes(
        button.attributes('aria-label') ?? '',
      ),
    )
}

describe('a group inside a group', () => {
  const nested = [group('g1', 'Transit', [layer('l1'), group('g2', 'Rail', [])])]

  it('gets a row of its own, rendered inside its parent', () => {
    const { wrapper } = render(nested)
    const rows = wrapper.findAllComponents(CanvasGroupRow)
    expect(rows.map(row => row.props('group').name)).toEqual(['Transit', 'Rail'])
    expect(rows[0].html()).toContain('Rail')
  })

  it('invites a drop only inside a group, not at the top level', () => {
    const { wrapper } = render(nested)
    // The outer group has contents; the inner one is the empty target.
    expect(wrapper.text()).toContain('Drag layers and marks in here')
    expect(render([layer('l1')]).wrapper.text()).not.toContain(
      'Drag layers and marks in here',
    )
  })
})

describe('choosing where new marks go', () => {
  const nested = [group('g1', 'Transit', [group('g2', 'Rail', [])])]

  it('aims at the group whose row was clicked, however deep it sits', async () => {
    const { wrapper, activeGroupId } = render(nested)
    await destinationButtons(wrapper)[1].trigger('click')
    expect(activeGroupId.value).toBe('g2')
  })

  it('hands new marks back to the canvas when the same row is clicked again', async () => {
    const { wrapper, activeGroupId } = render(nested)
    const button = () => destinationButtons(wrapper)[0]
    await button().trigger('click')
    expect(activeGroupId.value).toBe('g1')
    await button().trigger('click')
    expect(activeGroupId.value).toBeNull()
  })
})
