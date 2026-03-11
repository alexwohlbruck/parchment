import { APIPage as BaseAPIPage, type ApiPageProps } from 'fumadocs-openapi/ui'
import { openapi } from '@/lib/openapi'

export function APIPage(props: ApiPageProps) {
  return <BaseAPIPage {...openapi.getAPIPageProps(props)} />
}
