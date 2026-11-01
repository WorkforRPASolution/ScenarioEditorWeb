'use strict'
const { NEXT, FAIL, SUCCESS } = require('../lib/builders')
const { AREAS } = require('./basic')

// 200 스텝 모두 이미지 스텝, 기준 화면 각 약 560KB(base64) → BI 합계 100MB 이상.
module.exports = [{
  name: 'BIG_200', process: 'SEWPHOTO', model: 'SEWMODELA', desc: '큰 시나리오 (BI 100MB 넘음)',
  build: (w, img) => {
    w.targetWindow('EQ Control*', 'WindowsForms10')
    for (let i = 1; i <= 200; i++) {
      w.image({ fx: 'alarm', area: AREAS.DIALOG, train: AREAS.RESET, click: '24:12', desc: `큰 스텝 ${i}`,
        bi: img.noisy('alarm', 1000 + i, 420 * 1024), next: i === 200 ? [SUCCESS, FAIL] : [NEXT, FAIL] })
    }
  },
  expect: { list: { visible: true, status: [] }, open: { ok: true }, minBiBytes: 100 * 1024 * 1024 }
}]
