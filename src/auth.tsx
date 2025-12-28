// Google OAuth + JWT 인증 시스템
import { Hono } from 'hono'
// OAuth는 수동으로 구현
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'

type Bindings = {
  DB: D1Database
}

interface User {
  id: number
  email: string
  name: string
  picture?: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
}

interface JWTPayload {
  sub: string // user id
  email: string
  name: string
  role: string
  iat: number
  exp: number
}

const auth = new Hono<{ Bindings: Bindings }>()

// JWT 헬퍼 함수들
const createJWT = async (user: User, secret: string): Promise<string> => {
  const payload: JWTPayload = {
    sub: String(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7일
  }
  return await sign(payload, secret)
}

const verifyJWT = async (token: string, secret: string): Promise<JWTPayload | null> => {
  try {
    const payload = await verify(token, secret)
    return payload as JWTPayload
  } catch {
    return null
  }
}

// 사용자 조회/생성
const findOrCreateUser = async (db: D1Database, googleUser: any): Promise<User> => {
  // 기존 사용자 조회
  const existing = await db.prepare(`
    SELECT id, email, name, picture, role 
    FROM users 
    WHERE provider = 'google' AND provider_user_id = ?
  `).bind(googleUser.sub).first()

  if (existing) {
    // 사용자 정보 업데이트
    await db.prepare(`
      UPDATE users 
      SET email = ?, name = ?, picture = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(googleUser.email, googleUser.name, googleUser.picture, existing.id).run()
    
    return {
      id: existing.id as number,
      email: existing.email as string,
      name: existing.name as string,
      picture: existing.picture as string,
      role: existing.role as any
    }
  }

  // 새 사용자 생성 (첫 사용자는 ADMIN, 이후는 VIEWER)
  const { results } = await db.prepare('SELECT COUNT(*) as count FROM users').all()
  const userCount = (results?.[0] as any)?.count || 0
  const role = userCount === 0 ? 'ADMIN' : 'VIEWER'

  const result = await db.prepare(`
    INSERT INTO users (provider, provider_user_id, email, name, picture, role)
    VALUES ('google', ?, ?, ?, ?, ?)
    RETURNING id, email, name, picture, role
  `).bind(googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, role).first()

  return {
    id: result.id as number,
    email: result.email as string,
    name: result.name as string,
    picture: result.picture as string,
    role: result.role as any
  }
}

// Google OAuth 시작 (수동 구현)
auth.get('/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID || ''
  const redirectUri = c.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback'
  
  const scope = [
    'openid',
    'email', 
    'profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ')
  
  const state = Math.random().toString(36).substring(2)
  
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', scope)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  
  return c.redirect(authUrl.toString())
})

// OAuth 콜백 처리 (간단한 데모 버전)
auth.get('/callback', async (c) => {
  try {
    // 일단 간단히 데모 사용자로 로그인 처리
    const demoUser = {
      id: 1,
      sub: 'demo_user_' + Date.now(),
      email: 'ikjoobang@gmail.com',
      name: 'Demo User',
      picture: 'https://via.placeholder.com/100'
    }

    // 사용자 조회/생성
    const user = await findOrCreateUser(c.env.DB, demoUser)

    // JWT 토큰 생성
    const secret = c.env.AUTH_SECRET || 'dev-secret-for-local-only'
    const token = await createJWT(user, secret)

    // 서명 쿠키 설정
    setCookie(c, 'auth_token', token, {
      httpOnly: true,
      secure: false, // 개발 환경
      sameSite: 'Lax',
      maxAge: 7 * 24 * 60 * 60, // 7일
      path: '/'
    })

    // 감사 로그
    await c.env.DB.prepare(`
      INSERT INTO audit_logs (user_id, action, detail)
      VALUES (?, 'LOGIN', ?)
    `).bind(user.id, `Demo OAuth login: ${user.email}`).run()

    return c.redirect('/?login=success')
  } catch (error) {
    console.error('OAuth callback error:', error)
    return c.redirect('/?error=callback_failed')
  }
})

// 로그아웃
auth.post('/logout', async (c) => {
  const token = getCookie(c, 'auth_token')
  
  if (token) {
    const secret = c.env.AUTH_SECRET || 'dev-secret-for-local-only'
    const payload = await verifyJWT(token, secret)
    
    if (payload) {
      // 감사 로그
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (user_id, action, detail)
        VALUES (?, 'LOGOUT', ?)
      `).bind(parseInt(payload.sub), `Logout: ${payload.email}`).run()
    }
  }

  // 쿠키 삭제
  deleteCookie(c, 'auth_token', { path: '/' })
  
  return c.json({ success: true, message: 'Logged out successfully' })
})

// 현재 사용자 정보
auth.get('/me', async (c) => {
  const token = getCookie(c, 'auth_token')
  if (!token) {
    return c.json({ authenticated: false }, 401)
  }

  const secret = c.env.AUTH_SECRET || 'dev-secret-for-local-only'
  const payload = await verifyJWT(token, secret)
  
  if (!payload) {
    return c.json({ authenticated: false, error: 'Invalid token' }, 401)
  }

  // 최신 사용자 정보 조회
  const user = await c.env.DB.prepare(`
    SELECT id, email, name, picture, role, created_at
    FROM users 
    WHERE id = ?
  `).bind(parseInt(payload.sub)).first()

  if (!user) {
    return c.json({ authenticated: false, error: 'User not found' }, 404)
  }

  return c.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      created_at: user.created_at
    }
  })
})

// 인증 미들웨어 (다른 모듈에서 사용)
export const requireAuth = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  const secret = c.env.AUTH_SECRET || 'dev-secret-for-local-only'
  const payload = await verifyJWT(token, secret)
  
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // 사용자 정보를 context에 추가
  c.set('user', {
    id: parseInt(payload.sub),
    email: payload.email,
    name: payload.name,
    role: payload.role
  })

  await next()
}

// 역할 기반 권한 체크
export const requireRole = (roles: string[]) => {
  return async (c: any, next: any) => {
    const user = c.get('user')
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }
    await next()
  }
}

export default auth