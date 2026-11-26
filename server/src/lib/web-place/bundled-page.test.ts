import { expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { unbundlePage } from './bundled-page'

test('unpacks the markup and images of a bundled page', () => {
  const markup = '<p>Coming soon</p><img src="abc" alt="logo">'
  const html = `<script type="__bundler/manifest">${JSON.stringify({
    abc: { mime: 'image/png', compressed: true, data: gzipSync(Buffer.from('png')).toString('base64') },
    js: { mime: 'text/javascript', compressed: false, data: '' },
  })}</script><script type="__bundler/template">${JSON.stringify(markup)}</script>`
  const page = unbundlePage(html)
  expect(page?.html).toBe(markup)
  expect([...page!.assets.keys()]).toEqual(['abc'])
  expect(page!.assets.get('abc')!.bytes.toString()).toBe('png')
})

test('leaves an ordinary page alone', () => {
  expect(unbundlePage('<html><body>Hi</body></html>')).toBeNull()
})
