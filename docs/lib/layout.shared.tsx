import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

const clientOrigin = process.env.NEXT_PUBLIC_CLIENT_ORIGIN ?? 'http://localhost:5173'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Parchment Docs',
    },
    links: [
      {
        text: 'Open App',
        url: clientOrigin,
        external: true,
      },
    ],
  }
}
