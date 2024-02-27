import { Icon } from '../components/map/map.data'

export type Hotkey = string[]

export type Command = {
  id: string
  name: string
  description?: string
  hotkey?: Hotkey
  action?: Function
  icon: Icon
}
