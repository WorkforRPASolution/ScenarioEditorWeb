import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SECONDARY } from '../components/buttonStyle'

// 보조 단추 모양(2026-11-19 사용자 결정 — 위쪽 바 시안 비교에서 A "테두리 버튼 + 색 아이콘", 다른 보조 단추에도 맞춘다).
// 회색으로 채운 단추는 꺼진 단추처럼 보였다. WebManager 에서 가장 많이 쓰는 보조 단추(흰 바탕·회색 테두리)와 같게 한다.
describe('보조 단추 모양', () => {
  it('SECONDARY = 흰 바탕·회색 테두리, 누를 수 있을 때만 옅게 바뀌고 꺼지면 흐리다(크기는 쓰는 곳이 정한다)', () => {
    const cls = SECONDARY.split(' ')
    for (const c of ['bg-white', 'dark:bg-dark-card', 'border', 'border-gray-300', 'dark:border-gray-600', 'text-gray-700', 'dark:text-gray-200',
      'hover:enabled:bg-gray-50', 'dark:hover:enabled:bg-dark-border', 'disabled:opacity-50', 'disabled:cursor-not-allowed']) expect(cls).toContain(c)
    expect(cls.filter((c) => /^(h-|w-|px-|py-|text-(xs|sm|\[)|rounded)/.test(c))).toEqual([])
  })

  it('기능 폴더의 화면에 회색으로 채운 단추(bg-gray-200 dark:bg-gray-700)가 없다 — 진행 막대는 단추가 아니다', () => {
    const files = import.meta.glob(['../**/*.vue', '!../tests/**'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(files).length).toBeGreaterThan(50)
    const bad = []
    for (const [f, src] of Object.entries(files)) {
      src.split('\n').forEach((line, i) => {
        if (/bg-gray-200 dark:bg-gray-700/.test(line) && !/h-2 rounded-full/.test(line)) bad.push(`${f}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })

  it('CSS 로 그린 단추(저장·새 시나리오 창 .se-sv-btn, 운영 속성·성과·전처리 창 .se-pp-btn)의 보조 모양도 흰 바탕·회색 테두리', () => {
    // CSS 의 ?raw 가져오기는 시험에서 빈 글이라 파일을 직접 읽는다
    const css = ['../components/save/save.css', '../components/property/property.css'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
    expect(css.every((src) => src.length > 1000)).toBe(true)
    const rule = (sel) => {
      for (const src of css) {
        const m = src.match(new RegExp(`(?:^|\\n)${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`))
        if (m) return m[1]
      }
      return null
    }
    const sv = rule('.se-sv-btn')
    expect(sv).toMatch(/border: 1px solid #d1d5db/)
    expect(sv).toMatch(/background: #fff/)
    expect(rule('.dark .se-sv-btn')).toMatch(/background: #1e293b/)
    const pp = rule('.se-pp-btn')
    expect(pp).toMatch(/border: 1px solid var\(--pp-line2\)/)
    expect(pp).toMatch(/background: var\(--pp-card\)/)
    // 채운 단추(주 동작·지우기)는 테두리도 같은 색 — 흰 테두리가 비치지 않게
    expect(rule('.se-sv-btn.p')).toMatch(/border-color: #3b82f6/)
    expect(rule('.se-pp-btn.p')).toMatch(/border-color: var\(--pp-pri\)/)
    expect(rule('.se-pp-btn.danger')).toMatch(/border-color: #ef4444/)
  })
})
