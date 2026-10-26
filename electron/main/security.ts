import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 64

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN).toString('hex')
  return `scrypt$${salt}$${derived}`
}

export function verifyPassword(password: string, stored: string) {
  try {
    const [algorithm, salt, expectedHex] = stored.split('$')
    if (algorithm !== 'scrypt' || !salt || !expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function sha256Bytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export function newToken() {
  return randomBytes(32).toString('base64url')
}

export function newId(prefix = '') {
  const id = randomBytes(12).toString('hex')
  return prefix ? `${prefix}_${id}` : id
}
