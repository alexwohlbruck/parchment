import { Component } from 'vue'
import { Icon } from '@/types/app.types'
import { MapEngine } from '@/types/map.types'
import type { ThemeColor } from '@/lib/utils'
import { CommandName } from '@/stores/command.store'

export type Hotkey = string[]

export type PaletteItem = {
  name: string
  description?: string
  keywords?: string
  icon?: Icon
  iconName?: string
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
  /** When set, the item renders this image in the icon circle instead of a glyph (e.g. a brand logo). */
  imageUrl?: string
}

export type Command = PaletteItem & {
  id: CommandName
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
  getItems: (
    query?: string,
    signal?: AbortSignal,
  ) => CommandArgumentOption[] | Promise<CommandArgumentOption[]>
  customItemComponent?: Component
}

export type CommandArgumentOption = PaletteItem & {
  value: string | number
  group?: string
  /** Themed icon colour (ThemeColor) — used by tile-layout groups like Frequents. */
  color?: ThemeColor
  /** When true, the option is shown but gated behind a premium subscription. */
  premium?: boolean
}
