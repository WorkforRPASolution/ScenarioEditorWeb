'use strict'
// authorityManager 의 { long: n } 표시는 적재 때 Long.fromNumber 로 바꾼다.
const base = { line: 'SEWLINE1', isActive: true, accountStatus: 'active' }
module.exports = [
  { ...base, singleid: 'sew_master', name: 'SEW 마스터', process: 'MASTER', authority: 'WRITE', authorityManager: 1 },
  { ...base, singleid: 'sew_cvd', name: 'SEW CVD', process: 'SEWCVD', authorityManager: 0 },
  { ...base, singleid: 'sew_multi', name: 'SEW 여러 공정', process: 'SEWCVD;SEWETCH', authority: 'WRITE', authorityManager: 3 },
  { ...base, singleid: 'sew_mastercvd', name: 'SEW MASTER;CVD', process: 'MASTER;SEWCVD', authority: 'WRITE', authorityManager: 2 },
  { ...base, singleid: 'sew_spaces', name: 'SEW 공백', process: 'SEWCVD; SEWETCH', authority: 'WRITE', authorityManager: 0 },
  { ...base, singleid: 'sew_longgrade', name: 'SEW Int64 등급', process: 'SEWPHOTO', authority: 'WRITE', authorityManager: { long: 2 } }
]
