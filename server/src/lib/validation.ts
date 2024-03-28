export function isValidEmail(email: string): boolean {
  return /.+@.+/.test(email)
}
