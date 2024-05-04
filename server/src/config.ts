const isProduction = process.env.NODE_ENV === 'production'
export const appName = 'Parchment Maps'

const productionServerOrigin = 'https://api.parchment.lat'
const developmentServerOrigin = 'http://localhost:5000'
const productionClientOrigin = 'https://parchment.lat'
const developmentClientOrigin = 'http://localhost:5173'

export const hostname = (origin: string) => origin.replace(/(^\w+:|^)\/\//, '')

export const serverOrigin = isProduction
  ? productionServerOrigin
  : developmentServerOrigin
export const clientOrigin = isProduction
  ? productionClientOrigin
  : developmentClientOrigin

export const serverHostname = hostname(serverOrigin)
export const clientHostname = hostname(clientOrigin)
