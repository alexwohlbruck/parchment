import type { ComputedRef, InjectionKey, Ref } from 'vue'

export const collectionGroupContextKey: InjectionKey<{
  collapsed: Ref<Set<string>>
  counts: ComputedRef<Map<string, number>>
}> = Symbol('collection-group-tree')
