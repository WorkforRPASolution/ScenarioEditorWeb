import { describe, it, expect, afterEach } from 'vitest'
import { pickImageFile } from '../editor/pickFile'
import { LOCAL_BASE_ACCEPT } from '../editor/localBase'

const inputs = () => [...document.querySelectorAll('input[type="file"][data-testid="se-file-pick"]')]
const choose = (el, files) => { Object.defineProperty(el, 'files', { value: files, configurable: true }); el.dispatchEvent(new Event('change')) }

describe('pickImageFile — 파일 고르기 창(숨긴 input 하나)', () => {
  afterEach(() => { inputs().forEach((el) => el.remove()) })
  it('숨긴 파일 입력 칸을 만들어 누르고, 고른 첫 파일을 준 뒤 칸을 치운다', async () => {
    const p = pickImageFile()
    const [el] = inputs()
    expect(el.hidden).toBe(true)
    expect(el.accept).toBe(LOCAL_BASE_ACCEPT)
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    choose(el, [file, new File(['y'], 'b.png')])
    expect(await p).toBe(file)
    expect(inputs()).toHaveLength(0)
  })
  it('창에서 취소하면 null', async () => {
    const p = pickImageFile()
    inputs()[0].dispatchEvent(new Event('cancel'))
    expect(await p).toBe(null)
    expect(inputs()).toHaveLength(0)
    const q = pickImageFile()
    choose(inputs()[0], [])
    expect(await q).toBe(null)
  })
  it('앞의 칸이 남아 있으면(취소를 알리지 않는 브라우저) 치우고 새로 만든다', async () => {
    pickImageFile()
    const p = pickImageFile()
    expect(inputs()).toHaveLength(1)
    const file = new File(['x'], 'a.png')
    choose(inputs()[0], [file])
    expect(await p).toBe(file)
  })
})
