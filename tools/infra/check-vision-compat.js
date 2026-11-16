'use strict'
// 진짜 이미지 찾기 엔진 맞춤 확인 (P4 설계 §10) — 웹 API(POST /vision-test) → InterfaceServer → VisionServer(OpenCV)로 한 번 돌려,
// 찾은 좌표가 "보낸 조각 안에서 찾을 그림의 왼쪽 위" 인지 본다(웹이 조각의 자리를 더해 화면 좌표로 바꾸는 기준의 확인).
// 흉내 판정 서버는 똑같은 픽셀만 찾으므로 좌표 기준이 진짜 엔진과 같은지는 이 확인이 본다. 점수 척도·알고리즘은 견주지 않는다.
//
// 준비(맥):
//   1) InterfaceServer: docker compose -f infra/docker-compose.yml up -d && tools/infra/smoke-is.sh
//   2) VisionServer(작업 공간 ../VisionServer, 그 저장소는 고치지 않는다 — 가상환경은 그 README 대로):
//        cd ../VisionServer && VISION_ZK_HOSTS=127.0.0.1:2191 POD_IP=host.docker.internal VISION_GRPC_PORT=50061 VISION_HEALTH_PORT=18089 \
//          VISION_REDIS_URL=redis://:<로컬 비밀번호>@127.0.0.1:6379 VISION_HISTORY_DISABLED=true .venv/bin/python -m vision_server
//      (전용 ZooKeeper 의 호스트 포트 2191 에 host.docker.internal:50061 로 올라간다. 시험 요청(RequestVision)은 Redis 를 읽지도 쓰지도 않는다.)
//   3) 웹 서버: SE_DEV_USER_OVERRIDE=1 npm --prefix server start   (server/.env 의 EARS_INTERFACE_GRPC_ADDR=127.0.0.1:9310)
// 실행: node tools/infra/check-vision-compat.js   — 어긋나면 종료 코드 1. 끝나면 VisionServer·웹 서버를 내린다(노드는 저절로 지워진다).
const { PNG } = require('pngjs')

const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const USER = process.env.SE_USER || 'sew_master'
const SCREEN = { w: 640, h: 360 }
const AREA = { x: 180, y: 90, w: 300, h: 180 } // 검색 영역(화면 좌표)
const TRAIN = { w: 48, h: 32 }

// 씨앗이 정해진 난수 — 돌릴 때마다 같은 그림
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}
// 화면: 어두운 바탕에 잔 무늬. 같은 조각이 우연히 두 번 나오지 않는다
function screen(seed = 7) {
  const r = rng(seed)
  const png = new PNG({ width: SCREEN.w, height: SCREEN.h })
  for (let i = 0; i < SCREEN.w * SCREEN.h; i++) {
    const v = 30 + Math.floor(r() * 60)
    png.data.set([v, v + Math.floor(r() * 20), v + Math.floor(r() * 30), 255], i * 4)
  }
  return png
}
// 단추처럼 생긴 조각(테두리 + 안쪽 무늬)
function button(seed) {
  const r = rng(seed)
  const png = new PNG({ width: TRAIN.w, height: TRAIN.h })
  for (let y = 0; y < TRAIN.h; y++) {
    for (let x = 0; x < TRAIN.w; x++) {
      const edge = x < 2 || y < 2 || x >= TRAIN.w - 2 || y >= TRAIN.h - 2
      const v = edge ? 230 : 40 + Math.floor(r() * 180)
      png.data.set([edge ? 230 : 30, v, edge ? 230 : 200, 255], (y * TRAIN.w + x) * 4)
    }
  }
  return png
}
function crop(png, x0, y0, w, h) {
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0)
  return out
}
const bytes = (png) => PNG.sync.write(png)

async function visionTest(source, train, accept = 0.9) {
  const fd = new FormData()
  fd.append('meta', JSON.stringify({ accept, about: { scenario: 'check-vision-compat' } }))
  fd.append('source', new Blob([source], { type: 'image/png' }), 'source.png')
  fd.append('train', new Blob([train], { type: 'image/png' }), 'train.png')
  const res = await fetch(`${API}/vision-test`, { method: 'POST', body: fd, headers: { 'X-SE-User': USER } })
  const body = await res.json().catch(() => ({}))
  if (res.status !== 200) throw new Error(`POST /vision-test ${res.status} ${body.code || ''} ${body.error || ''}`)
  return body.data
}

async function main() {
  const failures = []
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} — ${detail}`)
    if (!ok) failures.push(label)
  }
  // 화면 좌표로 바꾸기: 조각의 왼쪽 위(검색 영역) + 받은 좌표의 소수 버림 — 화면(editor)과 같은 셈
  const toScreen = (r) => ({ x: AREA.x + Math.trunc(r.x), y: AREA.y + Math.trunc(r.y), score: r.score })
  const btn = button(11)
  const place = (spots) => {
    const s = screen()
    for (const [x, y] of spots) PNG.bitblt(btn, s, 0, 0, TRAIN.w, TRAIN.h, x, y)
    return bytes(crop(s, AREA.x, AREA.y, AREA.w, AREA.h))
  }
  const train = bytes(btn)

  // ① 영역 한가운데의 한 곳
  const one = [[300, 160]]
  let out = await visionTest(place(one), train)
  let got = out.results.map(toScreen)
  check('한 곳(영역 가운데)', got.length === 1 && got[0].x === 300 && got[0].y === 160,
    `기대 (300,160) · 받은 것 ${JSON.stringify(out.results)} → 화면 ${JSON.stringify(got)} · ${out.ms}ms · ${out.bytes}바이트`)

  // ② 영역 가장자리에서 3px 안쪽(VisionServer 의 가장자리 여백 안)
  const edge = [[AREA.x + 3, AREA.y + 3]]
  out = await visionTest(place(edge), train)
  got = out.results.map(toScreen)
  check('가장자리에서 3px', got.length === 1 && got[0].x === edge[0][0] && got[0].y === edge[0][1],
    `기대 (${edge[0]}) · 받은 것 ${JSON.stringify(out.results)}`)

  // ③ 두 곳
  const two = [[200, 110], [400, 220]]
  out = await visionTest(place(two), train)
  got = out.results.map(toScreen).sort((a, b) => a.x - b.x)
  check('두 곳', got.length === 2 && got[0].x === 200 && got[0].y === 110 && got[1].x === 400 && got[1].y === 220,
    `기대 (200,110)·(400,220) · 받은 것 ${JSON.stringify(out.results)}`)

  // ④ 없는 그림 — 0건(오류가 아니다)
  out = await visionTest(place([]), train)
  check('없는 그림은 0건', out.results.length === 0, `받은 것 ${JSON.stringify(out.results)}`)

  // ⑤ 다른 단추(무늬가 다르다)는 찾지 않는다
  out = await visionTest(place(one), bytes(button(99)))
  check('다른 그림은 0건', out.results.length === 0, `받은 것 ${JSON.stringify(out.results)}`)

  console.log(failures.length ? `\n어긋난 것 ${failures.length}: ${failures.join(' · ')}` : '\n좌표 기준이 맞는다(보낸 조각 안의 왼쪽 위)')
  return failures.length ? 1 : 0
}

main().then((code) => process.exit(code), (e) => { console.error(String(e.message || e)); process.exit(1) })
