import { Component } from 'vue'
import { Icon } from '@/types/app.types'
import { MapEngine } from '@/types/map.types'
import type { RouteBulletStyle } from '@/types/transit.types'
import type { ThemeColor } from '@/lib/utils'

export type Hotkey = string[]

export const COMMAND_CATEGORIES = [
  'general',
  'appearance',
  'map',
  'tools',
] as const
export type CommandCategory = (typeof COMMAND_CATEGORIES)[number]

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
  /** When set, the item renders a transit route bullet instead of an icon —
   *  the line's short name on its GTFS colour, pill-shaped when it's a word. */
  bullet?: RouteBulletStyle
}

export type Command = PaletteItem & {
  id: string
  /** Names the page or item a contextual command belongs to, e.g. a place's name. */
  context?: string
  category?: CommandCategory
  engine?: MapEngine[]
  /** Hides the command while this says no, e.g. a feature the user turned off. */
  isAvailable?: () => boolean
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
  /** Set on a recent, so its row can offer to forget it. */
  recentId?: string
  /** Themed icon colour (ThemeColor) — used by tile-layout groups like Frequents. */
  color?: ThemeColor
  /** When true, the option is shown but gated behind a premium subscription. */
  premium?: boolean
}
