// Hazard glyphs drawn for a 24×24 box, stroked; most are lucide's (ISC).

import type { RouteHazardKind } from '@/types/directions.types'

const TRIANGLE = 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01'

const PATHS: Partial<Record<RouteHazardKind, string>> = {
  crosswalk:
    'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0ZM20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0ZM16 17h4M4 13h4',
  ford: 'M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1',
  sharp_curve: 'M7 21v-7c0-5 10-5 10-10M13 3.5 17 4l.5 4',
  steep_grade: 'm8 3 4 8 5-5 5 15H2L8 3z',
  steps: 'M3 20h5v-5h5v-5h5V5h3',
  shared_space:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.13a4 4 0 0 1 0 7.74M22 21v-2a4 4 0 0 0-3-3.87M5 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
}

export const HAZARD_ICON_STROKE = 2.2

export function hazardIcon(kind: RouteHazardKind): string {
  return PATHS[kind] ?? TRIANGLE
}
