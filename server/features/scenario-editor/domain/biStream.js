'use strict'
// BI(GridFS 파일 내용)를 통째로 문자열로 만들지 않고 TargetSnapshotList 항목을 하나씩 넘긴다. 100MB 가 넘는 판도 항목 하나만큼의 메모리로 읽는다.
// 결과는 JSON.parse + "객체이고 TargetSnapshotList 가 배열" 판정과 같다(시험으로 대조). 다른 점 하나: TargetSnapshotList 가 둘이면 마지막 값을 쓰지 않고 invalid 다.
// 값의 경계만 여기서 찾고, 값이 맞는지는 그 값을 JSON.parse 해서 본다.
const QUOTE = 0x22
const BACKSLASH = 0x5c
const COMMA = 0x2c
const COLON = 0x3a
const OPEN_OBJECT = 0x7b
const CLOSE_OBJECT = 0x7d
const OPEN_ARRAY = 0x5b
const CLOSE_ARRAY = 0x5d
const LIST_KEY = 'TargetSnapshotList'

const isSpace = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09

// 다음에 올 것
const START = 0
const KEY_OR_CLOSE = 1
const KEY = 2
const AFTER_KEY = 3
const VALUE = 4
const AFTER_VALUE = 5
const ITEM_OR_END = 6
const ITEM = 7
const AFTER_ITEM = 8
const DONE = 9
const INVALID = 10

function createScanner() {
  let expect = START
  let hasList = false
  let keyIsList = false
  let value = null // 읽고 있는 값: { role, parts, depth, inString, escaped, scalar }

  function beginValue(role, first) {
    value = {
      role,
      parts: [],
      depth: first === OPEN_OBJECT || first === OPEN_ARRAY ? 1 : 0,
      inString: first === QUOTE,
      escaped: false,
      scalar: first !== QUOTE && first !== OPEN_OBJECT && first !== OPEN_ARRAY
    }
  }

  function endValue(items) {
    const { role, parts } = value
    value = null
    let parsed
    try {
      parsed = JSON.parse((parts.length === 1 ? parts[0] : Buffer.concat(parts)).toString('utf8'))
    } catch {
      expect = INVALID
      return
    }
    if (role === KEY) {
      keyIsList = parsed === LIST_KEY
      if (keyIsList && hasList) { expect = INVALID; return }
      if (keyIsList) hasList = true
      expect = AFTER_KEY
    } else if (role === ITEM) {
      items.push(parsed)
      expect = AFTER_ITEM
    } else {
      expect = AFTER_VALUE
    }
  }

  // 값의 끝까지(또는 조각 끝까지) 읽고 다음 위치를 돌려준다. 값의 첫 바이트는 from 에 있다.
  function readValue(chunk, from, isFirst, items) {
    const v = value
    let i = isFirst && !v.scalar ? from + 1 : from
    let end = -1
    for (; i < chunk.length; i++) {
      const b = chunk[i]
      if (v.inString) {
        if (v.escaped) v.escaped = false
        else if (b === BACKSLASH) v.escaped = true
        else if (b === QUOTE) {
          v.inString = false
          if (v.depth === 0) { end = i + 1; break }
        }
      } else if (v.scalar) {
        if (isSpace(b) || b === COMMA || b === CLOSE_OBJECT || b === CLOSE_ARRAY) { end = i; break }
      } else if (b === QUOTE) {
        v.inString = true
      } else if (b === OPEN_OBJECT || b === OPEN_ARRAY) {
        v.depth++
      } else if (b === CLOSE_OBJECT || b === CLOSE_ARRAY) {
        v.depth--
        if (v.depth === 0) { end = i + 1; break }
      }
    }
    if (end === -1) {
      v.parts.push(chunk.subarray(from))
      return chunk.length
    }
    v.parts.push(chunk.subarray(from, end))
    endValue(items)
    return end
  }

  return {
    // 이 조각에서 끝난 항목들을 돌려준다.
    feed(chunk) {
      const items = []
      let i = 0
      while (i < chunk.length && expect !== INVALID) {
        if (value) { i = readValue(chunk, i, false, items); continue }
        const b = chunk[i]
        if (isSpace(b)) { i++; continue }
        switch (expect) {
          case START:
            expect = b === OPEN_OBJECT ? KEY_OR_CLOSE : INVALID
            i++
            break
          case KEY_OR_CLOSE:
          case KEY:
            if (b === CLOSE_OBJECT && expect === KEY_OR_CLOSE) { expect = DONE; i++ } else if (b === QUOTE) { beginValue(KEY, b); i = readValue(chunk, i, true, items) } else expect = INVALID
            break
          case AFTER_KEY:
            expect = b === COLON ? VALUE : INVALID
            i++
            break
          case VALUE:
            if (keyIsList) {
              expect = b === OPEN_ARRAY ? ITEM_OR_END : INVALID
              i++
            } else {
              beginValue(VALUE, b)
              i = readValue(chunk, i, true, items)
            }
            break
          case AFTER_VALUE:
            if (b === COMMA) expect = KEY
            else expect = b === CLOSE_OBJECT ? DONE : INVALID
            i++
            break
          case ITEM_OR_END:
          case ITEM:
            if (b === CLOSE_ARRAY && expect === ITEM_OR_END) { expect = AFTER_VALUE; i++ } else { beginValue(ITEM, b); i = readValue(chunk, i, true, items) }
            break
          case AFTER_ITEM:
            if (b === COMMA) expect = ITEM
            else expect = b === CLOSE_ARRAY ? AFTER_VALUE : INVALID
            i++
            break
          default: // DONE 뒤에 공백 말고 다른 것이 왔다
            expect = INVALID
        }
      }
      return items
    },
    invalid: () => expect === INVALID,
    complete: () => expect === DONE && hasList
  }
}

// chunks: Buffer 조각의 (비동기) 반복자. onSnapshot(index, value) 은 항목마다 차례로 기다린다.
// 돌려주는 값: 'empty'(0 바이트, 기준 화면이 아예 없는 판), 'ok', 'invalid'. invalid 는 이미 넘긴 항목도 무효다.
async function scanBi(chunks, onSnapshot) {
  const scanner = createScanner()
  let bytes = 0
  let index = 0
  for await (const chunk of chunks) {
    bytes += chunk.length
    for (const item of scanner.feed(chunk)) await onSnapshot(index++, item)
    if (scanner.invalid()) return 'invalid'
  }
  if (bytes === 0) return 'empty'
  return scanner.complete() ? 'ok' : 'invalid'
}

module.exports = { scanBi }
