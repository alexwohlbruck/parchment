import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { fuzzyFilter } from '@/lib/utils'
import {
  settingsIndex,
  type SettingsPageDef,
  type SettingsSectionDef,
} from '@/views/settings/settingsIndex'

// A flat search target: one entry per section AND per item, so a user can
// type "3D terrain" and land on the right place. Items inherit their
// section's anchor since items aren't anchored individually in the DOM.
export type SettingsSearchEntry = {
  pageId: string
  to: string
  pageTitle: string
  sectionId: string
  sectionTitle: string
  hash: string
  // The text the user is actually looking for: section title for section
  // entries, item title for item entries.
  title: string
  description?: string
  // Concatenated, lowercased haystack for fuzzy matching. Includes title,
  // description, page title, and any extra keywords from the index.
  haystack: string
  level: 'section' | 'item'
}

export function useSettingsIndex() {
  const { t, te } = useI18n()
  const authService = useAuthService()

  const tr = (key: string | undefined): string | undefined => {
    if (!key) return undefined
    return te(key) ? t(key) : undefined
  }

  // Filter out pages the current user can't access. Permissions on a page
  // hide all of its sections from both the sub-nav and the search.
  const allowedPages = computed<SettingsPageDef[]>(() => {
    return settingsIndex.filter(
      page => !page.permissions || authService.hasPermission(page.permissions),
    )
  })

  // Sections grouped by page, with i18n applied. Used by the sidebar to
  // render sub-nav items beneath each tab.
  const sectionsByPage = computed(() => {
    const map = new Map<
      string,
      { id: string; title: string; hash: string }[]
    >()
    for (const page of allowedPages.value) {
      map.set(
        page.pageId,
        page.sections.map(section => ({
          id: section.id,
          title: tr(section.titleKey) ?? section.id,
          hash: `#${section.id}`,
        })),
      )
    }
    return map
  })

  // Flat search index. Sections come first; items follow grouped under
  // their section, which keeps fuzzysort's score ordering meaningful.
  const searchEntries = computed<SettingsSearchEntry[]>(() => {
    const entries: SettingsSearchEntry[] = []
    for (const page of allowedPages.value) {
      const pageTitle = tr(`settings.${page.pageId}.title`) ?? page.pageId
      for (const section of page.sections) {
        const sectionTitle = tr(section.titleKey) ?? section.id
        const sectionDescription = tr(section.descriptionKey)
        entries.push({
          pageId: page.pageId,
          to: page.to,
          pageTitle,
          sectionId: section.id,
          sectionTitle,
          hash: `#${section.id}`,
          title: sectionTitle,
          description: sectionDescription,
          haystack: buildHaystack(
            sectionTitle,
            sectionDescription,
            pageTitle,
            section.keywords,
          ),
          level: 'section',
        })

        for (const item of section.items ?? []) {
          const itemTitle = tr(item.titleKey) ?? item.titleKey
          const itemDescription = tr(item.descriptionKey)
          entries.push({
            pageId: page.pageId,
            to: page.to,
            pageTitle,
            sectionId: section.id,
            sectionTitle,
            hash: `#${section.id}`,
            title: itemTitle,
            description: itemDescription,
            haystack: buildHaystack(
              itemTitle,
              itemDescription,
              `${pageTitle} ${sectionTitle}`,
              item.keywords,
            ),
            level: 'item',
          })
        }
      }
    }
    return entries
  })

  function search(query: string, limit = 12): SettingsSearchEntry[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const matches = fuzzyFilter(searchEntries.value, trimmed, {
      keys: ['haystack'],
      threshold: -10000,
    })
    return matches.slice(0, limit)
  }

  return {
    allowedPages,
    sectionsByPage,
    searchEntries,
    search,
  }
}

function buildHaystack(
  title: string,
  description: string | undefined,
  context: string,
  keywords: string[] | undefined,
): string {
  return [title, description ?? '', context, ...(keywords ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
