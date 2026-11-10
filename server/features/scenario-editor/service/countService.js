'use strict'
// 불러오기 창의 공정·모델 옆 수(2026-11-11 사용자 요청 — WebManager 필터의 "(건수)" 처럼): 등록된 시나리오 수와 내 초안 수.
// 공정 권한 안의 공정·모델만 싣는다(선택 목록에 없는 것은 세지 않는다). 둘 다 0 인 쌍은 싣지 않는다 — 화면이 0 으로 본다.
// 내 초안은 쓰기 사용자만 세고, 웹 전용 DB 를 못 읽어도 시나리오 수는 낸다(draftsCounted false).
const keyOf = (process, model) => JSON.stringify([process, model])
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function createCountService({ repo, web, scopes, log = null }) {
  return {
    async counts(user) {
      const { pairs } = await scopes.scopeFor(user)
      const allowed = new Set(pairs.flatMap((p) => p.models.map((m) => keyOf(p.process, m.model))))
      if (!allowed.size) return { draftsCounted: false, pairs: [] }
      const out = new Map()
      const put = (rows, field) => {
        for (const r of rows) {
          const k = keyOf(r.process, r.model)
          if (!allowed.has(k) || !(r.count > 0)) continue
          if (!out.has(k)) out.set(k, { process: r.process, model: r.model, scenarios: 0, drafts: 0 })
          out.get(k)[field] = r.count
        }
      }
      put(await repo.countScenarios(pairs.map((p) => p.process)), 'scenarios')
      let draftsCounted = false
      if (user.canWrite) {
        try { put(await web.countDrafts(user.singleid), 'drafts'); draftsCounted = true } catch (e) { log?.warn(`counts ${user.singleid} 내 초안 수를 읽지 못했다: ${e.code || e.message}`) }
      }
      return { draftsCounted, pairs: [...out.values()].sort((a, b) => byName(a.process, b.process) || byName(a.model, b.model)) }
    }
  }
}

module.exports = { createCountService }
