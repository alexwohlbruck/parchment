export type MentionPart = { text: string } | { text: string; mention: number }

/**
 * The answer split around the first mention of each cited name, so the view
 * can draw those as chips. Longer names win, so "Joe's Pizza Express" isn't
 * read as "Joe's Pizza".
 */
export function splitMentions(text: string, names: readonly string[]): MentionPart[] {
  const order = names
    .map((name, mention) => ({ name: name.trim(), mention }))
    .filter(({ name }) => name.length > 2)
    .sort((a, b) => b.name.length - a.name.length)

  let parts: MentionPart[] = [{ text }]
  for (const { name, mention } of order) {
    const index = parts.findIndex(part => !('mention' in part) && part.text.includes(name))
    if (index < 0) continue
    const part = parts[index]
    const at = part.text.indexOf(name)
    const pieces: MentionPart[] = [
      ...(at > 0 ? [{ text: part.text.slice(0, at) }] : []),
      { text: name, mention },
      ...(at + name.length < part.text.length ? [{ text: part.text.slice(at + name.length) }] : []),
    ]
    parts = [...parts.slice(0, index), ...pieces, ...parts.slice(index + 1)]
  }
  return parts
}
