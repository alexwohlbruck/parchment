// TODO: Convert to environment vars
export const serverOrigin = process.env.SERVER_ORIGIN
export const clientOrigin = process.env.CLIENT_ORIGIN

export const hostname = (origin: string) => origin.replace(/(^\w+:|^)\/\//, '')

export const serverHostname = hostname(serverOrigin!)
export const clientHostname = hostname(clientOrigin!)
