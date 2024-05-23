// TODO: Convert to environment vars
const productionServerOrigin = 'https://parchment.onrender.com' //'https://api.parchment.app'
const developmentServerOrigin = 'http://localhost:5000'
const productionClientOrigin = 'https://parchment-maps.netlify.app' // 'https://app.parchment.app'
const developmentClientOrigin = 'http://localhost:5173'

const isProduction = process.env.NODE_ENV === 'production'
export const hostname = (origin: string) => origin.replace(/(^\w+:|^)\/\//, '')

export const serverOrigin = isProduction
  ? productionServerOrigin
  : developmentServerOrigin
export const clientOrigin = isProduction
  ? productionClientOrigin
  : developmentClientOrigin

export const serverHostname = hostname(serverOrigin)
export const clientHostname = hostname(clientOrigin)
