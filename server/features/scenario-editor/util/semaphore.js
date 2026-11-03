'use strict'
// 동시에 limit 개까지만 돌리고, 나머지는 온 순서대로 기다린다.
function createSemaphore(limit) {
  let active = 0
  const waiting = []
  const release = () => {
    active--
    const next = waiting.shift()
    if (next) next()
  }
  return {
    run(fn) {
      return new Promise((resolve) => {
        const start = () => {
          active++
          resolve(Promise.resolve().then(fn).finally(release))
        }
        if (active < limit) start()
        else waiting.push(start)
      })
    }
  }
}

module.exports = { createSemaphore }
