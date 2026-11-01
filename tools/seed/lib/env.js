'use strict'
// server/.env 와 같은 이름. 값이 없으면 로컬 기본값.
module.exports = {
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/EARS',
  REDIS_URL: process.env.REDIS_URL || 'redis://:visuallove@localhost:6379/0',
  EARS_INTERFACE_URL: process.env.EARS_INTERFACE_URL || 'http://localhost:8080',
  SETSCENARIO_TIMEOUT_MS: Number(process.env.SETSCENARIO_TIMEOUT_MS || 120000)
}
