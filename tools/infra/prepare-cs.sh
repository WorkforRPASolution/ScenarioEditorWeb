#!/usr/bin/env bash
# 실제 CommandServer 맞춤 확인 준비(시험 실행 P5) — CommandServer 빌드 결과물을 infra/cs/dist 로 복사한다.
# CommandServer 저장소는 건드리지 않는다(읽기만). RV(tibrv)는 컴파일 스텁을 함께 싣는다 — -DMODE=DEBUG 로 띄워 RV 를 쓰지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CS="$ROOT/../CommandServer"
DIST="$ROOT/infra/cs/dist"

if [[ ! -f "$CS/target/CommandServer.jar" || ! -d "$CS/target/lib" ]]; then
  echo "CommandServer 빌드 결과물이 없습니다: $CS/target/CommandServer.jar"
  echo "CommandServer 저장소에서 JDK 8 로 빌드하세요(그 저장소 CLAUDE.md '로컬 빌드 조건')."
  exit 1
fi
if [[ -n "$(git -C "$CS" status --short -- src pom.xml)" ]]; then
  echo "CommandServer 저장소의 src·pom.xml 에 커밋하지 않은 변경이 있습니다 — 커밋된 판으로 맞춰 봐야 합니다."
  exit 1
fi
mkdir -p "$DIST"
cp "$CS/target/CommandServer.jar" "$DIST/"
rsync -a --delete "$CS/target/lib/" "$DIST/lib/"
STUB="$CS/stubs/tibrvj/build/tibrvj-stub.jar"
if [[ -f "$STUB" ]]; then cp "$STUB" "$DIST/lib/"; fi
echo "복사함: CommandServer.jar (lib $(ls "$DIST/lib" | wc -l | tr -d ' ')개)"
echo "출처 jar 수정 시각: $(stat -f '%Sm' "$CS/target/CommandServer.jar") · 저장소 커밋: $(git -C "$CS" log -1 --format='%h %ci')"
echo "띄우기: docker compose -f infra/docker-compose.yml --profile cs up -d cs-redis command-server   확인: node tools/infra/check-command-compat.js"
