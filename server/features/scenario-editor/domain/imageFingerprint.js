'use strict'
// 그림 내용 지문(SEW-019): 뼈대가 뗀 그림(기준 화면·찾을 그림·보정 그림)마다 싣는다. 그림 URL 은 판마다 달라
// [이 버전으로 되돌려 열기] 세션에서 고치지 않은 그림 스텝까지 "저장 전 N곳" 에 잡혔다 — 화면이 판 사이 그림을 이 지문으로 견준다.
// 뗀 그림은 정규 base64 뿐(skeleton.isImage)이라 글자와 바이트가 1:1 이다 — 바이트로 풀지 않고 글자를 잰다.
// 같음만 가리면 되므로 sha256 앞 32자(128비트)로 줄인다(BIG_200 뼈대에 약 400개).
const { createHash } = require('node:crypto')

const fingerprintOf = (base64) => createHash('sha256').update(base64).digest('hex').slice(0, 32)

module.exports = { fingerprintOf }
