const express = require('express')
const { authenticate } = require('../../shared/middleware/authMiddleware')
const { asyncHandler } = require('../../shared/middleware/errorHandler')
const c = require('./controller')

const router = express.Router()
router.use(authenticate)
router.use(asyncHandler(c.loadUser))

router.get('/me', asyncHandler(c.me))
router.get('/scopes', asyncHandler(c.scopes))
router.post('/cache/refresh', asyncHandler(c.refreshCache))
router.get('/scenarios', asyncHandler(c.list))
router.get('/scenarios/:process/:model/:name/versions', asyncHandler(c.versions))
router.get('/scenarios/:process/:model/:name/versions/:crtime', asyncHandler(c.open))
router.get('/scenarios/:process/:model/:name/versions/:crtime/images/:imageId', asyncHandler(c.image))

module.exports = router
