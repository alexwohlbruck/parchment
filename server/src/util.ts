import { alphabet, generateRandomString } from 'oslo/crypto'

export function generateId() {
  return generateRandomString(24, alphabet('A-Z', 'a-z', '0-9'))
}

export async function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
