import jwt from 'jsonwebtoken'

import { getJwtSecret } from './config/env';

export interface JWTPayload {
  userId: number
  email: string
  tokenVersion?: number
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload
  } catch (error) {
    return null
  }
}
