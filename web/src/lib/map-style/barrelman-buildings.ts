/**
 * Whether Barrelman is serving the 3D buildings yet.
 *
 * The buildings the extrusion draws moved from the basemap to Barrelman's own
 * `buildings_3d` source, because only that one carries `hide_3d` — the flag
 * that says which of a part-mapped building's two footprints is the outline to
 * drop. See `BUILDING_3D_SOURCE` in `detail-layers.ts`.
 *
 * That source has to be created on the Barrelman instance before it answers,
 * and until it does, a style pointed at it draws no buildings at all: the tiles
 * 404 and MapLibre has nothing to extrude. Which is worse than the fault it
 * fixes — a doubled building is at least a building.
 *
 * So the switch is made only once the source is known to answer. The style
 * starts on the basemap, one tile is asked for, and if it comes back the style
 * is rebuilt on Barrelman. An instance that has been migrated pays one extra
 * tile request per session; one that has not keeps the map it had.
 */

/** Null until the probe has answered; the style reads it as "not yet". */
let available: boolean | null = null

/** Tile servers already asked, so a style rebuild does not ask again. */
const asked = new Map<string, Promise<boolean>>()

/** Whether the style should read buildings from Barrelman rather than the basemap. */
export function barrelmanBuildingsReady(): boolean {
  return available === true
}

/**
 * Test seam: force the answer, and forget which tile servers have been asked.
 *
 * Both, because they are one piece of state between them — leaving the cache
 * behind would have the next probe replay the previous test's answer.
 */
export function setBarrelmanBuildingsReady(value: boolean | null): void {
  available = value
  asked.clear()
}

/**
 * Ask the tile server for one buildings tile, and remember the answer.
 *
 * Asked at the map's own centre rather than at a fixed tile, so an instance
 * that has the source but has never populated it — the view is created empty
 * and filled out of band — reads as unavailable rather than as an empty map.
 * An empty answer over open water says the same thing, and costs nothing: the
 * basemap has no buildings there either.
 *
 * Resolves to whether the answer changed what the style should do, so a caller
 * can rebuild only when it must.
 */
export async function probeBarrelmanBuildings(
  tileUrl: (z: number, x: number, y: number) => string,
  centre: { lng: number; lat: number },
): Promise<boolean> {
  const z = 14
  const n = 2 ** z
  const x = Math.floor(((centre.lng + 180) / 360) * n)
  const lat = (centre.lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  )
  const url = tileUrl(z, x, y)

  let pending = asked.get(url)
  if (!pending) {
    pending = fetch(url)
      // Bytes, not just a status: a source that exists but is empty answers 204
      // or an empty body, and switching to it would trade doubled buildings for
      // none at all.
      .then(r => (r.ok ? r.arrayBuffer().then(b => b.byteLength > 0) : false))
      .catch(() => false)
    asked.set(url, pending)
  }

  const answer = await pending
  const changed = answer !== available
  available = answer
  return changed
}
