// STANDALONE STUB — 편입 시 WebManager 원본으로 교체
// 원본: WebManager@2f1eb0a server/shared/middleware/authMiddleware.js (150줄). export 5개와 동작 모양을 지킨다.
// 로그인·JWT 가 없다. 사용자는 설정 SE_USER_SINGLEID, 개발 전용으로 SE_DEV_USER_OVERRIDE=1 이면 헤더 X-SE-User 또는 쿼리 ?seUser=(<img> 용).
// req.user 에 authorityManager 는 없다 — 편집기 userService 가 ARS_USER_INFO 로 정한다.
const { ApiError } = require('./errorHandler')

function resolveSingleId(req) {
  if (process.env.SE_DEV_USER_OVERRIDE === '1') {
    const header = req.headers['x-se-user']
    if (typeof header === 'string' && header.trim() !== '') return header.trim()
    // <img> 는 헤더를 못 보낸다 — 개발 전용으로 쿼리도 받는다.
    const q = req.query && req.query.seUser
    if (typeof q === 'string' && q.trim() !== '') return q.trim()
  }
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
