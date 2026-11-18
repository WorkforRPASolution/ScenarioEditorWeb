'use strict'
// SEW 접두사로만 지운다(공유 로컬 EARS — WebManager 개발 데이터는 건드리지 않는다).
async function clean(ctx) {
  const r = {}
  r.scProperty = (await ctx.db.collection('SC_PROPERTY').deleteMany({ process: /^SEW/ })).deletedCount
  let files = 0
  for await (const f of ctx.db.collection('fs.files').find({ 'metadata.process': /^SEW/ }, { projection: { _id: 1 } })) {
    await ctx.bucket.delete(f._id)
    files++
  }
  r.gridfsFiles = files
  let cursor = '0'
  const keys = []
  do {
    const [next, batch] = await ctx.redis.scan(cursor, 'MATCH', 'SEW*-*', 'COUNT', 500)
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')
  if (keys.length) await ctx.redis.del(...keys)
  r.redisKeys = keys.length
  r.eqpInfo = (await ctx.db.collection('EQP_INFO').deleteMany({ eqpId: /^SEWT_/ })).deletedCount
  r.agentInfo = (await ctx.db.collection('AGENT_INFO').deleteMany({ eqpId: /^SEWT_/ })).deletedCount
  r.users = (await ctx.db.collection('ARS_USER_INFO').deleteMany({ singleid: /^sew_/ })).deletedCount
  // 시험 설비의 스냅샷 메모(P3-C). 컬렉션은 지우지 않는다 — 문서만.
  r.memos = (await ctx.db.collection('ARS_USER_MEMO').deleteMany({ eqpid: /^SEWT_/ })).deletedCount
  // 시험 설비의 실행 기록(P5 — CommandServer 흉내가 넣은 것). 컬렉션은 지우지 않는다 — 문서만.
  r.recoveries = (await ctx.db.collection('EQP_AUTO_RECOVERY').deleteMany({ eqpid: /^SEWT_/ })).deletedCount
  // 시험 수신 묶음·규칙(P5) — SEW 것만
  r.emailInfos = (await ctx.db.collection('EMAILINFO').deleteMany({ project: 'ARS', category: /^SEW-/ })).deletedCount
  r.emailRules = (await ctx.db.collection('EMAIL_RECIPIENTS').deleteMany({ app: 'ARS', process: /^SEW/ })).deletedCount
  return r
}

module.exports = { clean }
