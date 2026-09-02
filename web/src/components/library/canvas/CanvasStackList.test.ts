import { describe, it, expect } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia } from 'pinia'
import CanvasStackList from './CanvasStackList.vue'
import CanvasGroupRow from './CanvasGroupRow.vue'
import { CANVAS_STACK, type CanvasStackContext } from './canvas-stack-context'
import type { StackEntry } from '@/lib/canvas-stack'
import en from '@/lib/i18n/en-US.json'
import type { CanvasAnnotation, CanvasLayer } from '@/types/canvas.types'

/**
 * The stack panel renders itself inside every group, so the things worth
 * pinning are that the recursion actually happens — a group inside a group
 * gets a row of its own, at any depth — and that clicking one of those rows
 * points the panel at the group it sits on rather than the outermost.
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
  const selectedId = ref<string | null>(null)
  const context: CanvasStackContext = {
    layerProps: item => ({
      layer: item.layer,
      selected: false,
      onSelect: () => {},
      onToggle: () => {},
      onEdit: () => {},
      onRename: () => {},
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
    isSelected: id => selectedId.value === id,
    toggleSelected: id =>
      (selectedId.value = selectedId.value === id ? null : id),
    // The editor derives this from the selection; here it only has to agree
    // that the selected group is the one being drawn into.
    isDestination: id => selectedId.value === id,
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

  return { wrapper, selectedId }
}

/** The part of a group's row that points the panel at it. */
function groupButtons(wrapper: ReturnType<typeof render>['wrapper']) {
  return wrapper
    .findAll('button')
    .filter(button => button.attributes('aria-pressed') !== undefined)
}

describe('renaming a row from its title', () => {
  /** The real rows this time: the title is the thing under test. */
  function panel(entries: StackEntry[]) {
    const renamed: string[] = []
    const context: CanvasStackContext = {
      layerProps: item => ({
        layer: item.layer,
        selected: false,
        onSelect: () => {},
        onToggle: () => {},
        onEdit: () => {},
        onRename: name => renamed.push(`layer=${name}`),
        onRemove: () => {},
      }),
      annotationProps: item => ({
        annotation: item.annotation as CanvasAnnotation,
        expanded: false,
        onToggleExpanded: () => {},
        onUpdate: patch => renamed.push(`mark=${patch.label}`),
        onRemove: () => {},
        onZoomTo: () => {},
      }),
      isSelected: () => false,
      toggleSelected: () => {},
      isDestination: () => false,
      patchGroup: (_id, patch) => renamed.push(`group=${patch.name}`),
      removeGroup: () => {},
      onChange: () => {},
    }

    const wrapper = mount(CanvasStackList, {
      props: { entries },
      global: {
        plugins: [i18n, createPinia()],
        provide: { [CANVAS_STACK as symbol]: context },
        stubs: { draggable: DraggableStub },
      },
    })
    return { wrapper, renamed }
  }

  const rows = [
    group('g1', 'Transit', []),
    layer('l1'),
    {
      kind: 'annotation' as const,
      id: 'a1',
      annotation: {
        id: 'a1',
        tool: 'line',
        positions: [[0, 0], [1, 1]],
        label: 'Ridge path',
      } as CanvasAnnotation,
    },
  ]

  /** The title of a row, whichever kind of row it is. */
  const title = (wrapper: ReturnType<typeof panel>['wrapper'], name: string) =>
    wrapper.findAll('span, p').find(el => el.text() === name)!

  it('opens the name for editing wherever it is clicked', async () => {
    const { wrapper } = panel(rows)
    for (const name of ['Transit', 'l1', 'Ridge path']) {
      await title(wrapper, name).trigger('click')
      const field = wrapper.find('input')
      expect(field.exists()).toBe(true)
      expect((field.element as HTMLInputElement).value).toBe(name)
      // Leave it as it was for the next one.
      await field.trigger('keydown.esc')
    }
  })

  it('tells the canvas what each row is now called', async () => {
    const { wrapper, renamed } = panel(rows)
    const rename = async (from: string, to: string) => {
      await title(wrapper, from).trigger('click')
      const field = wrapper.find('input')
      await field.setValue(to)
      await field.trigger('keydown.enter')
    }

    await rename('Transit', 'Rail')
    await rename('l1', 'Relief')
    await rename('Ridge path', 'Summit path')

    expect(renamed).toEqual(['group=Rail', 'layer=Relief', 'mark=Summit path'])
  })

  it('keeps the old name when the edit is abandoned or emptied', async () => {
    const { wrapper, renamed } = panel(rows)

    await title(wrapper, 'Transit').trigger('click')
    await wrapper.find('input').setValue('Nope')
    await wrapper.find('input').trigger('keydown.esc')

    await title(wrapper, 'Transit').trigger('click')
    await wrapper.find('input').setValue('   ')
    await wrapper.find('input').trigger('keydown.enter')

    // A row with no name is unfindable; a blank one is a slip, not an order.
    expect(renamed).toEqual([])
  })
})

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

describe('selecting a group', () => {
  const nested = [group('g1', 'Transit', [group('g2', 'Rail', [])])]

  it('points at the group whose row was clicked, however deep it sits', async () => {
    const { wrapper, selectedId } = render(nested)
    await groupButtons(wrapper)[1].trigger('click')
    expect(selectedId.value).toBe('g2')
  })

  it('hands new marks back to the canvas when the same row is clicked again', async () => {
    const { wrapper, selectedId } = render(nested)
    const button = () => groupButtons(wrapper)[0]
    await button().trigger('click')
    expect(selectedId.value).toBe('g1')
    await button().trigger('click')
    expect(selectedId.value).toBeNull()
  })

  it('leaves folding the group to its own control', async () => {
    // The chevron and the row are different intentions: one folds, one aims.
    const { wrapper, selectedId } = render(nested)
    const chevron = wrapper
      .findAll('button')
      .find(b => b.attributes('aria-expanded') !== undefined)!
    await chevron.trigger('click')
    expect(selectedId.value).toBeNull()
  })
})
