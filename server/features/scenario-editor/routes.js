const express = require('express')
const { authenticate } = require('../../shared/middleware/authMiddleware')
const { asyncHandler } = require('../../shared/middleware/errorHandler')

const router = express.Router()
router.use(authenticate)

// 배선 확인용. P1-C 에서 /me 등 실제 API 가 붙는다.
router.get('/ping', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { singleid: req.user.singleid } })
}))

module.exports = router
