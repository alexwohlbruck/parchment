import { PLACE_ATTRIBUTES, type TagSet } from './place-attributes'
import { PLACE_GROUPS } from './place-groups'

const SEARCHABLE_TAG_SETS: Array<{ id: string; tagSet: TagSet }> = [
  ...PLACE_ATTRIBUTES.flatMap((a) => a.tagSets.map((tagSet) => ({ id: a.id, tagSet }))),
  ...PLACE_GROUPS.flatMap((g) =>
    g.members.flatMap((m) => (typeof m === 'string' ? [] : [{ id: g.id, tagSet: m }])),
  ),
]

/**
 * The attribute or group whose search finds places tagged `key=value`, given
 * the rest of the place's tags: free Wi-Fi needs `internet_access:fee=no` too.
 */
export function searchIdForTag(
  key: string,
  value: string,
  tags: Record<string, string>,
): string | undefined {
  return SEARCHABLE_TAG_SETS.find(({ tagSet }) =>
    tagSet[key] === value
    && Object.entries(tagSet).every(([k, v]) => tags[k] === v),
  )?.id
}
