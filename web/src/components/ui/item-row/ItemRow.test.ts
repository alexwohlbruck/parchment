import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import ItemRow from './ItemRow.vue'

let router: Router

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  router.push('/')
  await router.isReady()
})

const mountRow = (props: Record<string, unknown> = {}, slots = {}) =>
  mount(ItemRow, {
    props: { title: 'Blue Bottle', ...props },
    slots,
    global: { plugins: [router] },
  })

describe('ItemRow root element', () => {
  it('is a link when given a route, so middle-click still works', () => {
    expect(mountRow({ to: '/place/node/1' }).element.tagName).toBe('A')
  })

  it('is a plain div by default', () => {
    expect(mountRow().element.tagName).toBe('DIV')
  })

  it('can be a button for a row that acts rather than navigates', () => {
    const w = mountRow({ as: 'button' })
    expect(w.element.tagName).toBe('BUTTON')
    expect(w.attributes('type')).toBe('button')
  })

  it('keeps the link when both `to` and `as` are given', () => {
    expect(mountRow({ to: '/x', as: 'button' }).element.tagName).toBe('A')
  })
})

describe('ItemRow affordance', () => {
  it('shows hover affordance when it navigates', () => {
    expect(mountRow({ to: '/x' }).classes().join(' ')).toContain('cursor-pointer')
  })

  it('shows hover affordance when explicitly interactive without a route', () => {
    expect(mountRow({ interactive: true }).classes().join(' ')).toContain('cursor-pointer')
  })

  it('stays inert when it neither navigates nor claims to be interactive', () => {
    expect(mountRow().classes().join(' ')).not.toContain('cursor-pointer')
  })
})

describe('ItemRow icon sizing', () => {
  // Icon size follows the height of the text beside it. These two flags are
  // deliberately separate: one detail line takes the bigger icon but still
  // centres; only two or more switch to top alignment.
  const iconSlot = { icon: '<span :data-size="params.size" />' }

  it('uses the compact icon for a title-only row', () => {
    const w = mount(ItemRow, {
      props: { title: 'x', size: 'xs' },
      slots: { icon: `<template #icon="{ size }"><i :data-size="size" /></template>` },
      global: { plugins: [router] },
    })
    expect(w.find('i').attributes('data-size')).toBe('xs')
  })

  it('steps the icon up once any detail line renders', () => {
    const w = mount(ItemRow, {
      props: { title: 'x', size: 'xs', hasDetails: true },
      slots: { icon: `<template #icon="{ size }"><i :data-size="size" /></template>` },
      global: { plugins: [router] },
    })
    expect(w.find('i').attributes('data-size')).toBe('sm')
  })

  it('top-aligns only for two or more lines, not merely for having details', () => {
    const one = mountRow({ hasDetails: true })
    const many = mountRow({ hasDetails: true, multiline: true })
    expect(one.html()).toContain('items-center')
    expect(many.html()).toContain('items-start')
  })
})

describe('ItemRow variants', () => {
  it('chip renders a pill with no detail area', () => {
    const w = mountRow(
      { variant: 'chip' },
      { details: '<span class="detail">should not render</span>' },
    )
    expect(w.classes().join(' ')).toContain('rounded-full')
    expect(w.find('.detail').exists()).toBe(false)
  })

  it('inline drops the border and elevation, being nested in a card', () => {
    const cls = mountRow({ variant: 'inline' }).classes().join(' ')
    expect(cls).not.toContain('depth')
    expect(cls).toContain('bg-muted/40')
  })

  it('row and tile carry the app card surface', () => {
    for (const variant of ['row', 'tile'] as const) {
      const cls = mountRow({ variant }).classes().join(' ')
      expect(cls).toContain('rounded-lg')
      expect(cls).toContain('depth')
      expect(cls).toContain('bg-card')
    }
  })
})

describe('ItemRow slots', () => {
  it('exposes the detail type scale to the details slot', () => {
    const w = mount(ItemRow, {
      props: { title: 'x', size: 'lg' },
      slots: {
        details: `<template #details="{ detailClass }"><p :class="detailClass">d</p></template>`,
      },
      global: { plugins: [router] },
    })
    expect(w.find('p').classes()).toContain('text-sm')
  })

  it('renders trailing and title-trailing content in their own areas', () => {
    const w = mountRow({}, {
      trailing: '<button class="menu" />',
      'title-trailing': '<span class="badge" />',
    })
    expect(w.find('button.menu').exists()).toBe(true)
    expect(w.find('span.badge').exists()).toBe(true)
  })
})
