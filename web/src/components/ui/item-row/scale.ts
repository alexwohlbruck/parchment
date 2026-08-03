/**
 * The shared scale and surface vocabulary for icon + title + detail rows.
 *
 * Kept as data rather than inside a component so `ItemRow` and anything that
 * needs to match its typography (a card rendering its own detail lines into
 * `ItemRow`'s slot, for instance) read from one table.
 */

export type ItemRowSize = 'xs' | 'sm' | 'md' | 'lg'
export type ItemRowVariant = 'row' | 'tile' | 'inline' | 'chip'

export interface ItemRowScale {
  /** ItemIcon size for a title-only row. */
  icon: 'xs' | 'sm' | 'md' | 'lg'
  /** ItemIcon size once detail lines make the block taller. */
  iconWithDetails: 'xs' | 'sm' | 'md' | 'lg'
  title: string
  detail: string
  gap: string
  padding: string
  chipPadding: string
  /** Size for small glyphs sitting inside a detail line. */
  detailIcon: string
}

/**
 * Icon sizes come in pairs because the icon should match the height of the
 * text beside it, not the `size` prop alone. A title-only row is roughly one
 * line tall, so it takes the smaller icon; add detail lines and the block
 * grows and the icon steps up. Sizing off `size` alone is what made one-line
 * rows 56px tall with a 40px icon floating next to a 19px title.
 */
export const ITEM_ROW_SIZES: Record<ItemRowSize, ItemRowScale> = {
  xs: {
    icon: 'xs',
    iconWithDetails: 'sm',
    title: 'text-xs font-medium',
    detail: 'text-[11px]',
    gap: 'gap-1.5',
    padding: 'px-1.5 py-1.5',
    chipPadding: 'pl-0.5 pr-2 py-0.5',
    detailIcon: 'size-2.5',
  },
  sm: {
    icon: 'sm',
    iconWithDetails: 'sm',
    title: 'text-sm font-semibold',
    detail: 'text-xs',
    gap: 'gap-2',
    padding: 'px-2 py-2',
    chipPadding: 'pl-1 pr-2.5 py-1',
    detailIcon: 'size-3',
  },
  md: {
    // A detailed `md` row is typically title + one line (~38px), which the
    // 40px icon would overhang — so both cases anchor on 32.
    icon: 'sm',
    iconWithDetails: 'sm',
    title: 'text-sm font-semibold',
    detail: 'text-xs',
    gap: 'gap-2.5',
    padding: 'px-2.5 py-2',
    chipPadding: 'pl-1 pr-3 py-1',
    detailIcon: 'size-3',
  },
  lg: {
    icon: 'md',
    iconWithDetails: 'lg',
    title: 'text-base font-semibold',
    detail: 'text-sm',
    gap: 'gap-3',
    padding: 'p-3',
    chipPadding: 'pl-1.5 pr-3.5 py-1.5',
    detailIcon: 'size-3.5',
  },
}

/**
 * `rounded-lg` is the app's card radius: the Tailwind scale is remapped onto
 * the user's `--radius` setting in style.css, and `-lg` is the step that maps
 * to it exactly — the same one `components/ui/card` uses. Nested surfaces drop
 * to `-md` so an inline card inside a card doesn't out-round its container.
 *
 * A bare `border` is deliberate: style.css defaults every element's
 * border-color to `--color-border`, so `border-border` isn't needed.
 *
 * `depth` is the app's card elevation — an inset top highlight plus a soft
 * drop shadow — and is what `components/ui/card` applies. Every free-standing
 * surface takes it. `inline` is the exception: it's a well nested inside
 * another card, and lighting it would read as a card floating on a card.
 */
export const ITEM_ROW_SURFACES: Record<ItemRowVariant, string> = {
  row: 'w-full rounded-lg border bg-card depth',
  tile: 'shrink-0 rounded-lg border bg-card depth',
  inline: 'w-full rounded-md bg-muted/40',
  chip: 'rounded-full border bg-card depth',
}
