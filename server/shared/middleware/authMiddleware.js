// STANDALONE STUB — 편입 시 WebManager 원본으로 교체
// 원본: WebManager@2f1eb0a server/shared/middleware/authMiddleware.js (150줄). export 5개와 동작 모양을 지킨다.
// 로그인·JWT 가 없다. 사용자는 설정 SE_USER_SINGLEID, 개발 전용으로 SE_DEV_USER_OVERRIDE=1 이면 헤더 X-SE-User 또는
// 이미지 경로에서만 쿼리 ?seUser=(<img> 용). 두 덮어쓰기 모두 루프백에서 온 요청에만 효력이 있다.
// req.user 에 authorityManager 는 없다 — 편집기 userService 가 ARS_USER_INFO 로 정한다.
const { ApiError } = require('./errorHandler')

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
// 판 그림(/versions/<crtime>/files/<fileId>/images/<id>)과 초안 그림(/drafts/<id>/images/<tempId>, 2026-11-11 — 빠져 있어 사용자 바꾸기 때 404 였다)
// 스냅샷 그림(/snapshots/<설비>/<파일 이름>/image, P3-A 2026-11-12)
const IMAGE_PATH = /\/(?:versions\/[^/]+\/files\/[^/]+|drafts\/[^/]+)\/images\/[^/]+$|\/snapshots\/[^/]+\/[^/]+\/image$/
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''

function devOverride(req) {
  if (process.env.SE_DEV_USER_OVERRIDE !== '1') return ''
  // 원격 주소는 소켓에서 읽는다(X-Forwarded-For 같은 머리글로 꾸밀 수 없게).
  if (!LOOPBACK.has(req.socket && req.socket.remoteAddress)) return ''
  const header = req.headers['x-se-user']
  if (nonEmpty(header)) return header.trim()
  // <img> 는 헤더를 못 보낸다 — 이미지 경로에서만 쿼리도 받는다.
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0]
  const q = req.query && req.query.seUser
  if (IMAGE_PATH.test(path) && nonEmpty(q)) return q.trim()
  return ''
}

function resolveSingleId(req) {
  const dev = devOverride(req)
  if (dev) return dev
  const configured = process.env.SE_USER_SINGLEID
  return typeof configured === 'string' ? configured.trim() : ''
}

function authenticate(req, res, next) {
  const singleid = resolveSingleId(req)
  if (!singleid) {
    throw ApiError.unauthorized('SE_USER_SINGLEID is not configured')
  }
  req.user = { id: singleid, singleid }
  next()
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required')
    }
    const userLevel = req.user.authorityManager
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]
    if (!roles.includes(userLevel)) {
      throw ApiError.forbidden('Insufficient permissions')
    }
    next()
  }
}

function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required')
    }
    const userPermissions = req.user.permissions
    if (!userPermissions || !userPermissions[permission]) {
      throw ApiError.forbidden(`No permission for ${permission}`)
    }
    next()
  }
}

// 단독판에는 역할 권한 DB 가 없다(원본은 features/users/service 를 지연 require). 인증만 확인한다.
function requireMenuPermission() {
  return async (req, res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required')
    }
    next()
  }
}

function optionalAuth(req, res, next) {
  const singleid = resolveSingleId(req)
  if (singleid) {
    req.user = { id: singleid, singleid }
  }
  next()
}

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  requireMenuPermission,
  optionalAuth
}
