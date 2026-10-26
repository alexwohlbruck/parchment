import { toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { bannerDistance } from '@/lib/guidance/guidance-display'

/** "400 m", "1.2 mi": a banner distance with its translated unit. */
export function useDistanceLabel(metric: MaybeRefOrGetter<boolean>) {
  const { t } = useI18n()
  return (meters: number) => {
    const { value, unit } = bannerDistance(meters, toValue(metric))
    return `${value} ${t(`guidance.units.${unit}`)}`
  }
}
