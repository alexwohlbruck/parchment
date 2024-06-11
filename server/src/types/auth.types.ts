import { Permission } from '../schema/permission.schema'

export type PermissionRule =
  | Permission['id']
  | {
      all?: Permission['id'] | Permission['id'][]
      any?: Permission['id'][]
    }
