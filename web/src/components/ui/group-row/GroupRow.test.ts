import { it, expect } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GroupRow from './GroupRow.vue'
import en from '@/lib/i18n/en-US.json'

const global = {
  plugins: [
    createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } }),
  ],
}

it('uses an accessible collapse control and leaves other actions independent', async () => {
  const wrapper = mount(GroupRow, {
    props: { name: 'City', expanded: true, count: 3 },
    slots: {
      default: '<p>Contents</p>',
      actions: '<button data-action>Action</button>',
    },
    global,
  })
  expect(
    wrapper.find('[aria-label="Collapse City"]').attributes('aria-expanded'),
  ).toBe('true')
  await wrapper.find('[data-action]').trigger('click')
  expect(wrapper.emitted('update:expanded')).toBeUndefined()
  await wrapper.find('[aria-expanded]').trigger('click')
  expect(wrapper.emitted('update:expanded')).toEqual([[false]])
  await wrapper.setProps({ expanded: false })
  expect(wrapper.find('p').exists()).toBe(false)
  expect(wrapper.find('[aria-label="Expand City"]').exists()).toBe(true)
})

it('shares inline rename behavior: trimmed commit, escape cancel, empty names ignored', async () => {
  const wrapper = mount(GroupRow, {
    props: { name: 'City', expanded: true, renameable: true },
    global,
  })
  const title = () => wrapper.find('span[title="Rename"]')
  await title().trigger('click')
  await wrapper.find('input').setValue('  New York  ')
  await wrapper.find('input').trigger('keydown.enter')
  expect(wrapper.emitted('rename')).toEqual([['New York']])
  await title().trigger('click')
  await wrapper.find('input').setValue('Discarded')
  await wrapper.find('input').trigger('keydown.esc')
  await title().trigger('click')
  await wrapper.find('input').setValue('   ')
  await wrapper.find('input').trigger('keydown.enter')
  expect(wrapper.emitted('rename')).toHaveLength(1)
  expect(wrapper.emitted('update:expanded')).toBeUndefined()
})

it('keeps canvas selection separate from naming and expanding', async () => {
  const wrapper = mount(GroupRow, {
    props: { name: 'City', expanded: true, selectable: true, selected: true },
    global,
  })
  await wrapper.find('[aria-pressed="true"]').trigger('click')
  expect(wrapper.emitted('select')).toHaveLength(1)
  expect(wrapper.emitted('update:expanded')).toBeUndefined()
  await wrapper.find('[aria-expanded]').trigger('click')
  expect(wrapper.emitted('update:expanded')).toEqual([[false]])
  expect(wrapper.emitted('select')).toHaveLength(1)
})

it('does not rename a read-only group or accept a name over the module’s limit', async () => {
  const wrapper = mount(GroupRow, {
    props: {
      name: 'City',
      expanded: true,
      renameable: false,
      nameMaxLength: 4,
    },
    global,
  })
  await wrapper.find('span').trigger('click')
  expect(wrapper.find('input').exists()).toBe(false)
  await wrapper.setProps({ renameable: true })
  await wrapper.find('span[title="Rename"]').trigger('click')
  await wrapper.find('input').setValue('Too long')
  await wrapper.find('input').trigger('keydown.enter')
  expect(wrapper.emitted('rename')).toBeUndefined()
})

it('exposes the same rename and focus handoff to group menus', async () => {
  const wrapper = mount(
    defineComponent({
      components: { GroupRow },
      template:
        '<GroupRow name="City" expanded renameable><template #actions="{ startRename }"><button data-rename @click="startRename">Rename</button></template></GroupRow>',
    }),
    { global },
  )
  await wrapper.find('[data-rename]').trigger('click')
  expect(wrapper.find('input').exists()).toBe(true)
  expect((wrapper.find('input').element as HTMLInputElement).value).toBe('City')
})
