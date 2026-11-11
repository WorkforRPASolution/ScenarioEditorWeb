import { describe, it, expect } from 'vitest'
import { linksFromEnv } from '../../domain/links'

// 안내 문서 링크(P2-F 설계 §8). 단독판은 환경 변수, 편입 뒤에는 WebManager 설정으로 옮긴다.
describe('linksFromEnv', () => {
  const sop = (v) => linksFromEnv(v === undefined ? {} : { SE_LINK_PREPROCESSING_SOP: v })
  it('값이 없거나 비면 null(화면이 링크를 숨긴다)', () => {
    for (const v of [undefined, '', '   ']) expect(sop(v)).toEqual({ links: { preprocessingSop: null }, invalid: [] })
  })
  it('http·https 주소만 받는다(앞뒤 공백은 지운다)', () => {
    expect(sop(' https://wiki.example.com/ears/preprocessing?x=1#top ').links.preprocessingSop).toBe('https://wiki.example.com/ears/preprocessing?x=1#top')
    expect(sop('http://10.1.2.3:8080/sop').links.preprocessingSop).toBe('http://10.1.2.3:8080/sop')
  })
  it('그 밖의 값은 없는 것으로 보고 변수 이름을 알린다', () => {
    for (const v of ['javascript:alert(1)', 'file:///c:/sop.pdf', 'wiki.example.com/sop', '//wiki/sop', 'ftp://x/y', 'https://', 'http:// bad host/']) {
      expect(sop(v), v).toEqual({ links: { preprocessingSop: null }, invalid: ['SE_LINK_PREPROCESSING_SOP'] })
    }
  })
})
