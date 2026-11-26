import { gunzipSync } from 'node:zlib'

export interface BundledAsset {
  mime: string
  bytes: Buffer
}

/**
 * A page that ships as a script-unpacked bundle: its markup as a JSON string and
 * its images as base64, keyed by the ids the markup's `src` attributes use.
 */
export function unbundlePage(html: string): { html: string; assets: Map<string, BundledAsset> } | null {
  const template = bundlerBlock(html, 'template')
  if (!template) return null
  try {
    const markup = JSON.parse(template)
    if (typeof markup !== 'string') return null
    const manifest = JSON.parse(bundlerBlock(html, 'manifest') ?? '{}') as Record<
      string,
      { mime?: string; compressed?: boolean; data?: string }
    >
    const assets = new Map<string, BundledAsset>()
    for (const [id, asset] of Object.entries(manifest)) {
      if (!asset.mime?.startsWith('image/') || !asset.data) continue
      const bytes = Buffer.from(asset.data, 'base64')
      assets.set(id, { mime: asset.mime, bytes: asset.compressed ? gunzipSync(bytes) : bytes })
    }
    return { html: markup, assets }
  } catch {
    return null
  }
}

function bundlerBlock(html: string, kind: string): string | undefined {
  return html.match(new RegExp(`<script type="__bundler/${kind}">([\\s\\S]*?)</script>`))?.[1]
}
