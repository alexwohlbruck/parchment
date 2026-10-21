import { atHit, densify, metresPerUnit, onOwnDeck, vertex, type DeckSurface, type Mesh, type Point } from '../decks'

export function routeOverlay(mesh: Mesh, lines: Point[][], surfaces: DeckSurface[], origin: Point) {
  const dense = lines.map(line => densify(line, 3))
  const { under } = onOwnDeck(dense, [], surfaces, { centred: true })
  for (const [k, line] of dense.entries()) {
    for (const [width, lift, material] of [[4.4, 0.06, 16], [3, 0.08, 15]]) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        const ha = under.lines[k][i - 1], hb = under.lines[k][i]
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (!ha || !hb || !length) continue
        const scale = 1 / metresPerUnit(a[1])
        const nx = -(b[1] - a[1]) / length * scale, ny = (b[0] - a[0]) / length * scale
        const corners = [[a, ha, 1], [a, ha, -1], [b, hb, -1], [b, hb, 1]] as const
        for (const j of [0, 1, 2, 0, 2, 3]) {
          const [p, hit, side] = corners[j]
          const color = [material, 0, 0]
          vertex(mesh, [p[0] + nx * side * width / 2 - origin[0], p[1] + ny * side * width / 2 - origin[1], (hit.z + lift) * scale],
            [0, 0, 1], color, color, atHit(surfaces[hit.deck].bias, hit), [nx * side, ny * side, width / 2])
        }
      }
    }
  }
}
