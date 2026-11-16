#!/usr/bin/env bash
# InterfaceServer 컨테이너가 응답하고 Mongo 에 붙었는지 본다(getscenariolist 는 SC_PROPERTY 를 읽는다).
# InterfaceServer 는 뜰 때 ZooKeeper 에 붙은 뒤에야 Mongo 를 붙인다 — 막 띄운 뒤에는 포트가 열려도 저장 경로가 아직 안 된다.
# 그래서 포트가 아니라 저장 경로가 성공할 때까지 기다린다(SMOKE_WAIT_SEC, 기본 60초). 끝에 판정 중계 gRPC 포트도 본다.
set -euo pipefail
URL="${EARS_INTERFACE_URL:-http://localhost:8080}"
GRPC="${EARS_INTERFACE_GRPC_ADDR:-127.0.0.1:9310}"
WAIT="${SMOKE_WAIT_SEC:-60}"
deadline=$(( $(date +%s) + WAIT ))
body=""
while :; do
  body=$(curl -s -m 10 -X POST "$URL/EARS/Interface" \
    -H 'Content-Type: application/json' -H 'category: scenario' -H 'function: getscenariolist' \
    -d '{"Process":"SEWSMOKE","Model":"SEWSMOKE"}' || true)
  if echo "$body" | grep -q '"success":"true"'; then break; fi
  if (( $(date +%s) >= deadline )); then
    echo "$body"
    echo "FAIL: getscenariolist 응답이 ${WAIT}초 안에 success 가 되지 않음"
    exit 1
  fi
  sleep 2
done
echo "$body"
host="${GRPC%:*}"; port="${GRPC##*:}"
if ! (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
  echo "FAIL: 판정 중계 gRPC 포트($GRPC)에 연결되지 않음"
  exit 1
fi
echo "OK"
