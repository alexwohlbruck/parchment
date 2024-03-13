import { Component } from 'vue'
import { Icon } from '../components/map/map.data'

export type Hotkey = string[]

export type PaletteItem = {
  name: string
  description?: string
  keywords?: string
  icon?: Icon
}

export type Command = PaletteItem & {
  id: string
  hotkey?: Hotkey
  action?: Function
  arguments?: CommandArgument[]
}

export type ArgumentType = string | number

export type CommandArgument = {
  name: string
  type: 'string' | 'number'
  getItems: (query?: string) => CommandArgumentOption[]
  customItemComponent?: Component
}

export type CommandArgumentOption = PaletteItem & {
  value: string | number
}
