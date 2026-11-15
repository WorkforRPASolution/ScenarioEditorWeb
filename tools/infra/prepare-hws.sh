#!/usr/bin/env bash
# 로컬 이력 서버(HttpWebServer) 준비 — 커밋된 판(HEAD)을 저장소 밖 임시 폴더로 꺼내 JDK 8 로 빌드하고 infra/hws/dist 로 복사한다.
# HttpWebServer 저장소의 작업 트리는 읽지도 고치지도 않는다(git archive 만 — 그 저장소에 다른 작업의 미커밋 변경이 있을 수 있다, P3 설계 §14.1 ⑥).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HWS="$ROOT/../HttpWebServer"
DIST="$ROOT/infra/hws/dist"
JDK8="${JAVA8_HOME:-$(/usr/libexec/java_home -v 1.8 2>/dev/null || true)}"

if [[ ! -d "$HWS/.git" ]]; then
  echo "HttpWebServer 저장소가 없습니다: $HWS"
  exit 1
fi
if [[ -z "$JDK8" || ! -x "$JDK8/bin/java" ]]; then
  echo "JDK 8 을 찾지 못했습니다. JAVA8_HOME 으로 알려 주세요."
  exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sew-hws-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
COMMIT="$(git -C "$HWS" rev-parse --short HEAD)"
git -C "$HWS" archive HEAD | tar -x -C "$WORK"
echo "빌드: HttpWebServer $COMMIT (JDK $("$JDK8/bin/java" -version 2>&1 | head -1 | cut -d'"' -f2))"
(cd "$WORK" && JAVA_HOME="$JDK8" mvn -q -DskipTests package)
if [[ ! -f "$WORK/target/HttpWebServer.jar" || ! -d "$WORK/target/lib" ]]; then
  echo "빌드 결과물이 없습니다: target/HttpWebServer.jar"
  exit 1
fi
mkdir -p "$DIST"
cp "$WORK/target/HttpWebServer.jar" "$DIST/"
rsync -a --delete "$WORK/target/lib/" "$DIST/lib/"
# Jetty 가 정적 파일을 찾는 자리(parcels/HttpWebServer/public) — 이력 페이지가 참조하는 /js 가 여기 있다
rsync -a --delete "$WORK/src/main/_webapp/" "$DIST/public/"
echo "$COMMIT" > "$DIST/COMMIT"
echo "복사함: HttpWebServer.jar (lib $(ls "$DIST/lib" | wc -l | tr -d ' ')개, 커밋 $COMMIT)"
echo "띄우기: docker compose -f infra/docker-compose.yml up -d   확인: tools/infra/smoke-hws.sh"
