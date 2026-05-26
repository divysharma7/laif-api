import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { config } from '../config.js'

const SECRET = new TextEncoder().encode(config.JWT_SECRET)
export const COOKIE_NAME = 'pim_token'
const TOKEN_EXPIRY = '24h'

export interface TokenPayload extends JWTPayload {
  userId: string
  username: string
  name?: string
}

export async function signToken(payload: { userId: string; username: string; name?: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, SECRET)
  return payload as TokenPayload
}
