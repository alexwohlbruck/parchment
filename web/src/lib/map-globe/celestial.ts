import { siderealAngle } from '@/lib/map/sun-position'

const EQUATORIAL_TO_GALACTIC = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
]

export function galacticRotation(date: Date): Float32Array {
  const angle = siderealAngle(date)
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const matrix = new Float32Array(9)
  EQUATORIAL_TO_GALACTIC.forEach(([x, y, z], row) => {
    matrix[row] = -x * sin + y * cos
    matrix[row + 3] = z
    matrix[row + 6] = x * cos + y * sin
  })
  return matrix
}

export const MILKY_WAY_ATTRIBUTION = '<a href="https://www.eso.org/public/images/eso0932a/" target="_blank">ESO/S. Brunier (resized)</a>'
