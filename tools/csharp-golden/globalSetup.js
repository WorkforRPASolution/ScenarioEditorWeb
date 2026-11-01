// vitest 한 번 실행에 C# 기준 도구를 딱 한 번 빌드한다(병렬 시험 파일끼리 obj/·bin/out 을 두고 다투지 않게).
// dotnet 의 증분 빌드라 이미 최신이면 빠르고, 사본이 바뀌었으면 DLL 도 새로 만든다.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { dotnetAvailable, build } = require('./normalize')

export default function setup() {
  if (dotnetAvailable()) build()
}
