'use strict'
// server/.env 와 같은 이름. 값이 없으면 로컬 기본값.
module.exports = {
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/EARS',
  REDIS_URL: process.env.REDIS_URL || 'redis://:visuallove@localhost:6379/0',
  SETSCENARIO_TIMEOUT_MS: Number(process.env.SETSCENARIO_TIMEOUT_MS || 120000)
}
