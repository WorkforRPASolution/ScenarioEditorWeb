// 목업 v5 의 설비 화면을 1920×1200 PNG 로 찍는다(기준 화면·학습 이미지 원천). 한 번 만들어 커밋한다.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = dirname(fileURLToPath(import.meta.url))
const screen = ({ status, alarm = false, start = false }) => `<!doctype html><html><body style="margin:0">
<div style="position:relative;width:640px;height:400px;transform:scale(3);transform-origin:0 0;background:#d9dee5;font-family:Arial,sans-serif;overflow:hidden">
<div style="position:absolute;left:0;top:0;right:0;height:24px;background:#334155;color:#fff;font-size:11px;display:flex;align-items:center;padding:0 8px">EQ Control — SEWMODEL · SEWT</div>
<div style="position:absolute;left:0;top:24px;bottom:0;width:96px;background:#cbd5e1"></div>
<div style="position:absolute;left:122px;top:40px;font-weight:700;font-size:13px;color:#1f2937">STATUS: <span style="color:${status === 'IDLE' ? '#15803d' : status === 'RUN' ? '#1d4ed8' : '#dc2626'}">${status}</span></div>
<div style="position:absolute;left:122px;top:88px;width:218px;height:152px;background:rgba(255,255,255,.7);border:1px solid #94a3b8"></div>
<div style="position:absolute;left:358px;top:88px;width:243px;height:152px;background:rgba(255,255,255,.7);border:1px solid #94a3b8"></div>
<div style="position:absolute;left:448px;top:324px;width:90px;height:36px;background:${start ? '#16a34a' : '#64748b'};color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center">START</div>
${alarm ? `<div style="position:absolute;left:192px;top:112px;width:282px;height:160px;background:#fff;border:1px solid #64748b">
<div style="height:32px;background:#dc2626;color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;padding:0 10px">ALARM E1234</div>
<div style="padding:10px;font-size:11px">Vacuum pressure out of range</div>
<div style="position:absolute;left:45px;top:108px;width:85px;height:32px;background:#475569;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center">Reset</div>
<div style="position:absolute;left:152px;top:108px;width:85px;height:32px;background:#94a3b8;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center">Close</div></div>` : ''}
</div></body></html>`

const shots = { alarm: { status: 'ALARM', alarm: true }, idle: { status: 'IDLE' }, start: { status: 'IDLE', start: true }, run: { status: 'RUN' } }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } })
for (const [name, cfg] of Object.entries(shots)) {
  await page.setContent(screen(cfg))
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}
await browser.close()
console.log('고정 그림 4장:', Object.keys(shots).join(', '))
