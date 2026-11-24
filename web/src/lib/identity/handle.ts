export function handleDomain(handle: string): string {
  const at = handle.lastIndexOf('@')
  return at === -1 ? '' : handle.slice(at + 1).toLowerCase()
}

/** True when `handle` lives on a different server than `ourDomain`. */
export function isRemoteHandle(handle: string, ourDomain: string): boolean {
  const domain = handleDomain(handle)
  if (!domain || !ourDomain) return false
  return domain !== ourDomain.toLowerCase()
}
