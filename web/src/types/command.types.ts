import { Component } from 'vue'
import { Icon } from '@/types/app.types'
import { MapEngine } from '@/types/map.types'

export type Hotkey = string[]

export type PaletteItem = {
  name: string
  description?: string
  keywords?: string
  icon?: Icon
}

export type Command = PaletteItem & {
  id: string
  engine?: MapEngine[]
  hotkey?: Hotkey
  action?: Function
  arguments?: CommandArgument[]
}

export type ArgumentType = string | number

export type CommandArgument = {
  id: string
  name: string
  type: 'string' | 'number'
  getItems: (query?: string) => CommandArgumentOption[]
  customItemComponent?: Component
}

export type CommandArgumentOption = PaletteItem & {
  value: string | number
}
