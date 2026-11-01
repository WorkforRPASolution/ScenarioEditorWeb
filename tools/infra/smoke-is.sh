#!/usr/bin/env bash
# InterfaceServer 컨테이너가 응답하고 Mongo 에 붙었는지 본다(getscenariolist 는 SC_PROPERTY 를 읽는다).
set -euo pipefail
URL="${EARS_INTERFACE_URL:-http://localhost:8080}"
body=$(curl -s -m 10 -X POST "$URL/EARS/Interface" \
  -H 'Content-Type: application/json' -H 'category: scenario' -H 'function: getscenariolist' \
  -d '{"Process":"SEWSMOKE","Model":"SEWSMOKE"}')
echo "$body"
echo "$body" | grep -q '"success":"true"' || { echo "FAIL: getscenariolist 응답이 success 가 아님"; exit 1; }
echo "OK"
