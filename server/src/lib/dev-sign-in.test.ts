import { describe, expect, test } from 'bun:test'
import { devSignInRefusal } from './dev-sign-in'

const localUrl = 'postgresql://user:pass@127.0.0.1:5432/parchment'

describe('devSignInRefusal', () => {
  test('allows development against a local database', () => {
    expect(devSignInRefusal({ nodeEnv: 'development', dbUrl: localUrl })).toBeNull()
    expect(
      devSignInRefusal({
        nodeEnv: 'development',
        dbUrl: 'postgresql://u:p@parchment-db/parchment',
      }),
    ).toBeNull()
  })

  test.each([undefined, 'production', 'test', 'Development'])(
    'refuses NODE_ENV=%p',
    (nodeEnv) => {
      expect(devSignInRefusal({ nodeEnv, dbUrl: localUrl })).toContain('NODE_ENV')
    },
  )

  test('refuses a remote database even in development', () => {
    expect(
      devSignInRefusal({
        nodeEnv: 'development',
        dbUrl: 'postgresql://u:p@ep-example.us-east-1.aws.neon.tech/db?sslmode=require',
      }),
    ).toContain('not a local')
    expect(
      devSignInRefusal({
        nodeEnv: 'development',
        dbUrl: 'postgresql://u:p@localhost.evil.example/db',
      }),
    ).toContain('not a local')
  })

  test('refuses an unparseable database URL', () => {
    expect(devSignInRefusal({ nodeEnv: 'development', dbUrl: 'not a url' })).toContain(
      'parsed',
    )
  })
})
