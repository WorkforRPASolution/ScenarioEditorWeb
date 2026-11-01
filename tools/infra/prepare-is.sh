#!/usr/bin/env bash
# InterfaceServer 맥 빌드 결과물을 infra/is/dist 로 복사만 한다. InterfaceServer 저장소는 건드리지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IS="$ROOT/../InterfaceServer"
STUB="$HOME/.m2/repository/com/sec/eeg/ars/macstub/inhouse-stubs/1.0/inhouse-stubs-1.0.jar"
DIST="$ROOT/infra/is/dist"

if [[ ! -f "$IS/target/EARSInterfaceSrv.jar" || ! -d "$IS/target/lib" ]]; then
  echo "InterfaceServer 빌드 결과물이 없습니다: $IS/target/EARSInterfaceSrv.jar"
  echo "InterfaceServer 저장소의 tools/mac-build/README.md '사용' 절대로 빌드하세요(JDK 8, Docker)."
  exit 1
fi
if [[ ! -f "$STUB" ]]; then
  echo "사내 jar stub 이 없습니다: $STUB — InterfaceServer tools/mac-build/inhouse-stubs 에서 mvn install"
  exit 1
fi
mkdir -p "$DIST"
cp "$IS/target/EARSInterfaceSrv.jar" "$DIST/"
rsync -a --delete "$IS/target/lib/" "$DIST/lib/"
cp "$STUB" "$DIST/"
echo "복사함: $(ls "$DIST" | tr '\n' ' ') (lib $(ls "$DIST/lib" | wc -l | tr -d ' ')개)"
echo "출처 jar 수정 시각: $(stat -f '%Sm' "$IS/target/EARSInterfaceSrv.jar")"
