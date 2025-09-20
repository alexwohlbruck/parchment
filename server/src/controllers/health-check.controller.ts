import Elysia, { t } from 'elysia'
const packageJson = require('../../package.json')

const app = new Elysia()

app.get('/', async () => {
  return {
    status: 'Parchment server is running.',
    version: packageJson.version,
    
  }
})

export default app
