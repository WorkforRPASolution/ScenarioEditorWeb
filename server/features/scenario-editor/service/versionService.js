'use strict'
const { pickCurrent, uniqueDesc } = require('../domain/versionPick')
const { seError } = require('../errors')

function createVersionService({ gridfs, hash, scopes }) {
  return {
    async versions(user, process, model, name) {
      await scopes.assertAllowed(user, process, model)
      const [crtimes, fields] = await Promise.all([gridfs.findCrtimes(process, model, name), hash.hkeys(`${process}-${model}`)])
      const list = uniqueDesc(crtimes)
      if (!list.length) throw seError(404, 'NOT_FOUND', '저장된 버전이 없습니다')
      const current = pickCurrent(fields, name)
      return list.map((crtime) => ({ crtime, isCurrent: crtime === current }))
    }
  }
}

module.exports = { createVersionService }
