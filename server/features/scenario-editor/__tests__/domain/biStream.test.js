import { describe, it, expect } from 'vitest'
import { scanBi } from '../../domain/biStream'

// 흘려 읽기 전의 판정 그대로 — 스캐너의 결과는 이것과 같아야 한다.
function oracle(text) {
  if (text === '') return { state: 'empty', list: [] }
  try {
    const bi = JSON.parse(text)
    if (bi !== null && typeof bi === 'object' && !Array.isArray(bi) && Array.isArray(bi.TargetSnapshotList)) return { state: 'ok', list: bi.TargetSnapshotList }
  } catch {
    // 아래로
  }
  return { state: 'invalid', list: [] }
}

function* chunksOf(buf, size) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size)
}

async function scan(input, size) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const list = []
  const state = await scanBi(chunksOf(buf, size), async (i, v) => { expect(i).toBe(list.length); list.push(v) })
  return { state, list: state === 'invalid' ? [] : list }
}

const SIZES = [1, 2, 3, 7, 64, 1 << 20]

const VALID = [
  '',
  '{"TargetSnapshotList":[]}',
  '{"ID":"BI.P-M-N","TargetSnapshotList":["AAAA","AA=="]}',
  '  \n{\t"TargetSnapshotList" : [ "a" , "b" ]\r\n} \n',
  '{"TargetSnapshotList":["a\\"b","c\\\\","d\\\\\\"e","한글","\\u0041","]}"]}',
  '{"TargetSnapshotList":[5,{},null,["AAAA"],true,false,-1.5e3,0,"x",{"a":[1,{"b":"}]"}]}]}',
  '{"Target\\u0053napshotList":["escaped-key"]}',
  '{"A":{"TargetSnapshotList":["nested-no"]},"TargetSnapshotList":["yes"]}',
  '{"TargetSnapshotList":["first"],"After":{"x":[1,2,{"y":"}]"}],"z":null}}',
  '{"Before":"a,b}]\\"","N":-12.5,"T":true,"Nu":null,"TargetSnapshotList":["x"]}',
  '{"TargetSnapshotList":[[],[[]],{},{"a":{}}]}',
  '{"":1,"TargetSnapshotList":[""]}'
]
const INVALID = [
  ' ', '\n', '5', '[]', 'null', '"x"', 'true', '{}', '{"A":1}', '{깨짐', '{broken', '{', '{"', '{"A', '{"A"', '{"A":', '{"A":1', '{"A":1,',
  '{"TargetSnapshotList":"x"}', '{"TargetSnapshotList":null}', '{"TargetSnapshotList":{}}', '{"TargetSnapshotList":5}',
  '{"TargetSnapshotList":[', '{"TargetSnapshotList":["a', '{"TargetSnapshotList":["a"', '{"TargetSnapshotList":["a",', '{"TargetSnapshotList":["a"]',
  '{"TargetSnapshotList":["a"]}x', '{"TargetSnapshotList":["a"]}{}', '{"TargetSnapshotList":["a"]},',
  '{"TargetSnapshotList":["a"],}', '{"TargetSnapshotList":["a",]}', '{"TargetSnapshotList":[,"a"]}', '{"TargetSnapshotList":["a""b"]}', '{"TargetSnapshotList":["a" "b"]}',
  '{"TargetSnapshotList" ["a"]}', '{TargetSnapshotList:["a"]}', "{'TargetSnapshotList':['a']}", '{"TargetSnapshotList":["a"}', '{"TargetSnapshotList":["a"]]}',
  '{"A":tru,"TargetSnapshotList":[]}', '{"A":01,"TargetSnapshotList":[]}', '{"A":1 "TargetSnapshotList":[]}', '{"A":1,,"TargetSnapshotList":[]}', '{,"TargetSnapshotList":[]}',
  '{"TargetSnapshotList":[1 2]}', '{"TargetSnapshotList":[1}]}', '{"TargetSnapshotList":[[1}]}', '{"TargetSnapshotList":[{"a":1]]}', '{"TargetSnapshotList":[{"a"}]}',
  '{"TargetSnapshotList":["a\nb"]}', '{"TargetSnapshotList":["\\x"]}', '{"TargetSnapshotList":[nul]}', '{"TargetSnapshotList":[+1]}', '{"TargetSnapshotList":[.5]}',
  '{"A":[1},"TargetSnapshotList":[]}', '{"A":"x,"TargetSnapshotList":[]}', '{5:1,"TargetSnapshotList":[]}', '{"A"::1,"TargetSnapshotList":[]}',
  '﻿{"TargetSnapshotList":[]}', '[{"TargetSnapshotList":[]}]'
]

describe('scanBi 는 JSON.parse 판정과 같다', () => {
  it.each(VALID.map((t) => [t]))('맞는 BI: %j', async (text) => {
    const want = oracle(text)
    expect(want.state).not.toBe('invalid') // 표가 틀리면 여기서 드러난다
    for (const size of SIZES) expect(await scan(text, size), `조각 ${size}`).toEqual(want)
  })
  it.each(INVALID.map((t) => [t]))('틀린 BI: %j', async (text) => {
    expect(oracle(text).state).toBe('invalid')
    for (const size of SIZES) expect((await scan(text, size)).state, `조각 ${size}`).toBe('invalid')
  })
  it('글자가 조각 경계에서 잘려도 값이 같다', async () => {
    const text = '{"TargetSnapshotList":["가나다라마바사","🙂🙂"]}'
    for (const size of SIZES) expect((await scan(text, size)).list).toEqual(['가나다라마바사', '🙂🙂'])
  })
  it('깨진 UTF-8 바이트는 JSON.parse 와 같이 대체 문자가 된다', async () => {
    const buf = Buffer.concat([Buffer.from('{"TargetSnapshotList":["a'), Buffer.from([0xff, 0xc3]), Buffer.from('b"]}')])
    for (const size of SIZES) expect(await scan(buf, size), `조각 ${size}`).toEqual(oracle(buf.toString('utf8')))
  })

  it('맞는 문서를 임의로 뒤튼 입력 4000건도 판정과 값이 같다', async () => {
    // 고정 시드 — 실패하면 같은 입력으로 다시 볼 수 있다
    let seed = 0x5eed
    const rand = (n) => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) % n
    }
    const base = '{"ID":"BI.P","Nested":{"a":[1,"x\\"y",null,{"b":true}]},"TargetSnapshotList":["AAAA",5,{"k":["v"]},null,"\\u0041"],"Tail":-1.5e3}'
    const META = '{}[]",:\\ \n0a-.eE+tfn'
    for (let n = 0; n < 4000; n++) {
      let text = base
      for (let m = 1 + rand(3); m > 0; m--) {
        const at = rand(text.length + 1)
        const ch = META[rand(META.length)]
        const op = rand(3)
        if (op === 0) text = text.slice(0, at) + ch + text.slice(at)
        else if (op === 1) text = text.slice(0, at) + text.slice(at + 1)
        else text = text.slice(0, at) + ch + text.slice(at + 1)
      }
      if (text.split('"TargetSnapshotList"').length > 2) continue // 중복 키는 따로 정한다(아래)
      const size = [1, 3, 64][n % 3]
      expect(await scan(text, size), `${JSON.stringify(text)} 조각 ${size}`).toEqual(oracle(text))
    }
  })
})

describe('scanBi 동작', () => {
  it('TargetSnapshotList 가 둘이면 invalid 다(JSON.parse 의 "마지막 값" 과 다르게 정했다)', async () => {
    expect((await scan('{"TargetSnapshotList":["a"],"TargetSnapshotList":["b"]}', 3)).state).toBe('invalid')
  })
  it('스냅샷을 다 받기 전에 앞 스냅샷부터 넘긴다(통째로 모으지 않는다)', async () => {
    const buf = Buffer.from(`{"TargetSnapshotList":["${'A'.repeat(1000)}","${'B'.repeat(1000)}"]}`)
    let pulled = 0
    const chunks = (function* () { for (const c of chunksOf(buf, 100)) { pulled += c.length; yield c } })()
    const pulledAt = []
    await scanBi(chunks, async () => { pulledAt.push(pulled) })
    expect(pulledAt).toHaveLength(2)
    expect(pulledAt[0]).toBeLessThan(1200)
    expect(pulledAt[1]).toBe(buf.length)
  })
  it('넘기기가 끝나기를 기다렸다 다음을 넘긴다', async () => {
    const order = []
    await scanBi(chunksOf(Buffer.from('{"TargetSnapshotList":["a","b"]}'), 64), async (i) => {
      order.push(`시작${i}`)
      await new Promise((r) => setTimeout(r, 2))
      order.push(`끝${i}`)
    })
    expect(order).toEqual(['시작0', '끝0', '시작1', '끝1'])
  })
  it('틀린 것을 알면 나머지를 읽지 않는다', async () => {
    let pulled = 0
    const chunks = (function* () { for (const c of chunksOf(Buffer.from(`[${'x'.repeat(1000)}`), 10)) { pulled++; yield c } })()
    expect(await scanBi(chunks, async () => {})).toBe('invalid')
    expect(pulled).toBe(1)
  })
  it('읽기 도중 오류는 invalid 가 아니라 그대로 던진다', async () => {
    const chunks = (async function* () { yield Buffer.from('{"TargetSnapshotList":['); throw new Error('끊김') })()
    await expect(scanBi(chunks, async () => {})).rejects.toThrow('끊김')
  })
  it('넘기기가 실패하면 그대로 던진다', async () => {
    await expect(scanBi(chunksOf(Buffer.from('{"TargetSnapshotList":["a"]}'), 64), async () => { throw new Error('디스크') })).rejects.toThrow('디스크')
  })
})
