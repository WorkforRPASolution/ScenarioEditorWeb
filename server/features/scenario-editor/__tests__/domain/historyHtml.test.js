// 이력 HTML 에서 스텝·설명·그림 뽑기 (P3 설계 §5.6) — 이력 서버(HttpWebServer)가 준 HTML 은 화면에 넣지 않는다.
// fixtures/history-seed.html = 로컬 이력 서버가 시험 이력(tools/seed/data/history.js) 에 준 응답 그대로(2026-11-16).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { parseHistoryHtml } = require('../../domain/historyHtml')

const SEED = readFileSync(fileURLToPath(new URL('../fixtures/history-seed.html', import.meta.url)), 'utf8')
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const B64_2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC'
// HttpWorker.scala 의 AddHistory 가 만드는 조각 그대로
const piece = (step, text, ref = B64, screen = B64_2) =>
  `<table bgColor=#308cfc><tbody><tr><th><strong>${step}.${text}</strong><img width="15" height="15" src="data:Image/png;base64,${ref}" class="magnify" border="2" data-magnifyto="40" data-magnifyby="20" /></th></tr><tr><td bgColor=white height=100 align=center><img src="data:Image/png;base64,${screen}" class="magnify" border="2" width="150" max-height="100" data-magnifyto="640" data-magnifyby="360" /></td></tr></tbody></table><br>`
const page = (body) => `\n\n<!doctype html>\n<html lang="ko">\n<head>\n<script type="text/javascript" src="/js/jquery-1.9.1.min.js"> </script>\n<style>TABLE { HEIGHT: 100px; }</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`

describe('parseHistoryHtml — 실제 응답', () => {
  const steps = parseHistoryHtml(SEED)

  it('스텝 셋의 번호와 설명을 뽑는다 — 설명은 이력 서버가 넣은 글 그대로다', () => {
    expect(steps.map((s) => s.no)).toEqual([1, 2, 3])
    expect(steps.map((s) => s.text)).toEqual(['로그인 창 확인', "A<B & 'x' 버튼 누르기", '완료 화면 확인'])
  })

  it('스텝마다 기준 그림(ref)과 화면(screen) — 접두사는 소문자로 고쳐 싣는다', () => {
    for (const s of steps) {
      expect(s.images.map((i) => i.kind)).toEqual(['ref', 'screen'])
      for (const i of s.images) expect(i.src).toMatch(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/)
    }
    expect(steps[0].images[0].src).not.toBe(steps[0].images[1].src)
  })

  it('뽑은 것에는 태그·속성·스크립트가 없다', () => {
    const out = JSON.stringify(steps)
    for (const bad of ['<table', '<img', 'magnify', 'jquery', '<script', 'bgColor']) expect(out).not.toContain(bad)
  })
})

describe('parseHistoryHtml — 조각', () => {
  it('조각 하나를 읽는다', () => {
    expect(parseHistoryHtml(page(piece(7, '버튼 찾기')))).toEqual([
      { no: 7, text: '버튼 찾기', images: [{ kind: 'ref', src: `data:image/png;base64,${B64}` }, { kind: 'screen', src: `data:image/png;base64,${B64_2}` }] }
    ])
  })

  it('접두사의 대소문자를 가리지 않는다', () => {
    const html = page(piece(1, 'x').replace(/data:Image\/png/g, 'DATA:IMAGE/PNG'))
    expect(parseHistoryHtml(html)[0].images.map((i) => i.src)).toEqual([`data:image/png;base64,${B64}`, `data:image/png;base64,${B64_2}`])
  })

  it('설명 안의 태그·닫는 strong·그림 태그는 글자다 — 그림으로 세지 않는다', () => {
    const text = `<b>굵게</b> </strong><img src="data:image/png;base64,${B64}"><script>alert(1)</script>`
    const [s] = parseHistoryHtml(page(piece(3, text)))
    expect(s.no).toBe(3)
    expect(s.text).toBe(text)
    expect(s.images).toHaveLength(2)
    expect(s.images.map((i) => i.kind)).toEqual(['ref', 'screen'])
  })

  it('그림이 없거나(null·빈 값) base64 가 아니면 그 그림만 뺀다', () => {
    expect(parseHistoryHtml(page(piece(1, 'a', 'null', B64_2)))[0].images).toEqual([{ kind: 'screen', src: `data:image/png;base64,${B64_2}` }])
    expect(parseHistoryHtml(page(piece(1, 'a', B64, '')))[0].images).toEqual([{ kind: 'ref', src: `data:image/png;base64,${B64}` }])
    expect(parseHistoryHtml(page(piece(1, 'a', 'AAAA" onerror="alert(1)', 'javascript:alert(1)')))[0].images).toEqual([])
    expect(parseHistoryHtml(page(piece(1, 'a', `${B64}\n<x>`, B64_2)))[0].images.map((i) => i.kind)).toEqual(['screen'])
  })

  it('png 데이터 주소가 아닌 그림은 뺀다', () => {
    const html = page(piece(1, 'a').replace('data:Image/png;base64,' + B64, 'http://evil.example/x.png').replace('data:Image/png;base64,' + B64_2, 'data:image/svg+xml;base64,' + B64_2))
    expect(parseHistoryHtml(html)[0].images).toEqual([])
  })

  it('번호로 시작하지 않는 글은 번호 없이 준다', () => {
    const html = page(piece(1, 'x').replace('<strong>1.x</strong>', '<strong>설명만</strong>'))
    expect(parseHistoryHtml(html)[0]).toMatchObject({ no: null, text: '설명만' })
  })

  it('여러 스텝은 문서 순서대로', () => {
    expect(parseHistoryHtml(page(piece(2, 'b') + piece(10, 'c') + piece(1, 'a'))).map((s) => [s.no, s.text])).toEqual([[2, 'b'], [10, 'c'], [1, 'a']])
  })

  it('조각이 아닌 본문은 빈 배열이다', () => {
    expect(parseHistoryHtml(page('<script>alert(1)</script>'))).toEqual([])
    expect(parseHistoryHtml(page('<b>1단계</b><b>2단계</b>'))).toEqual([])
    expect(parseHistoryHtml(page('<table><tr><td>strong 이 없는 표</td></tr></table>'))).toEqual([])
    expect(parseHistoryHtml('')).toEqual([])
    expect(parseHistoryHtml(null)).toEqual([])
    expect(parseHistoryHtml({ html: 'x' })).toEqual([])
  })

  it('닫는 strong 이 없는 조각은 버린다', () => {
    expect(parseHistoryHtml(page('<table><tbody><tr><th><strong>1.끝이 없다<img src="data:image/png;base64,' + B64 + '"></th></tr></tbody></table>'))).toEqual([])
  })
})
