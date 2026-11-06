'use strict'
// 찾을 그림 표(TrainImageMap) 키 규칙 — 뼈대(그림 떼기)·편집 시나리오(참조 만들기)·조립이 같이 쓴다.
// 저장 본문(JSON)의 표는 { "키": { BinaryImage, Type } } 객체다. C# 은 Dictionary<int, TrainImage> 라 키는 int 의 표기("0", "12")뿐이다.

// 그림 ID·참조를 만드는 키: 음이 아닌 안전한 정수의 정규 표기. 그 밖의 키("-1"·"01"·"abc")는 저장값을 그대로 둔다
// (이미지 캐시가 그런 ID 를 거절하고, 표기가 둘인 키는 ID 가 겹칠 수 있다).
const isTrainKey = (k) => typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k) && Number.isSafeInteger(Number(k))
const trainImageId = (i, k) => `s${i}-train-${k}`

module.exports = { isTrainKey, trainImageId }
