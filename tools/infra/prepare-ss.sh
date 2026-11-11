#!/usr/bin/env bash
# 스냅샷 서버 맞춤 확인 준비 — SnapShotServer 빌드 결과물을 infra/ss/dist 로 복사하고, Cassandra 계정을 infra/.env 에 적는다.
# SnapShotServer 저장소는 건드리지 않는다(읽기만). 계정은 server/.env 의 CASSANDRA_USERNAME·CASSANDRA_PASSWORD 에서 읽는다(둘 다 git 제외 파일).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SS="$ROOT/../SnapShotServer"
DIST="$ROOT/infra/ss/dist"
ENV_SRC="$ROOT/server/.env"
ENV_OUT="$ROOT/infra/.env"

if [[ ! -f "$SS/target/ARSSnapShotServer.jar" || ! -d "$SS/target/lib" ]]; then
  echo "SnapShotServer 빌드 결과물이 없습니다: $SS/target/ARSSnapShotServer.jar"
  echo "SnapShotServer 저장소에서 JDK 8 로 mvn clean package 하세요(그 저장소 CLAUDE.md '빌드')."
  exit 1
fi
mkdir -p "$DIST"
cp "$SS/target/ARSSnapShotServer.jar" "$DIST/"
rsync -a --delete "$SS/target/lib/" "$DIST/lib/"
echo "복사함: ARSSnapShotServer.jar (lib $(ls "$DIST/lib" | wc -l | tr -d ' ')개)"
echo "출처 jar 수정 시각: $(stat -f '%Sm' "$SS/target/ARSSnapShotServer.jar")"

value() { grep -E "^$1=" "$ENV_SRC" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
USERNAME="$(value CASSANDRA_USERNAME)"
PASSWORD="$(value CASSANDRA_PASSWORD)"
if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "server/.env 에 CASSANDRA_USERNAME·CASSANDRA_PASSWORD 가 없습니다 — 스냅샷 서버는 계정 없이 뜨지 않습니다."
  exit 1
fi
umask 077
touch "$ENV_OUT"
grep -v -E '^SS_CASSANDRA_(USERNAME|PASSWORD)=' "$ENV_OUT" > "$ENV_OUT.tmp" || true
printf 'SS_CASSANDRA_USERNAME=%s\nSS_CASSANDRA_PASSWORD=%s\n' "$USERNAME" "$PASSWORD" >> "$ENV_OUT.tmp"
mv "$ENV_OUT.tmp" "$ENV_OUT"
echo "계정을 infra/.env 에 적음(git 제외)"
echo "띄우기: docker compose -f infra/docker-compose.yml --profile ss up -d   확인: node tools/infra/check-ss-compat.js"
