const isProduction = process.env.NODE_ENV === 'production'
export const appName = 'Parchment Maps'

const productionHostname = 'parchment.lat'
const developmentHostname = 'localhost:5000'

const productionOrigin = 'https://parchment.lat'
const developmentOrigin = 'http://localhost:5173'

export const origin = isProduction ? productionOrigin : developmentOrigin
export const hostname = isProduction ? productionHostname : developmentHostname

export const hostOrigin = `https://${hostname}`
export const allowedOrigins = [productionOrigin, developmentOrigin]
