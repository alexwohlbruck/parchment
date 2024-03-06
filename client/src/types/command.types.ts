import { Icon } from '../components/map/map.data'

export type Hotkey = string[]

export type PaletteItem = {
  name: string
  description?: string
}

export type Command = PaletteItem & {
  id: string
  hotkey?: Hotkey
  icon: Icon
  action?: Function
  arguments?: CommandArgument[]
}

export type CommandArgument = {
  name: string
  type: 'string' // TODO: Add more types
  getItems: (query?: string) => CommandArgumentOption[]
}

export type CommandArgumentOption = PaletteItem & {
  value: string // TODO: Add more types
}
