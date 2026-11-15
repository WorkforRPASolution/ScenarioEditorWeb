#!/usr/bin/env bash
# 로컬 이력 서버(HttpWebServer) 컨테이너가 응답하고 Cassandra 에 붙었는지 본다 — 없는 이력을 물으면 500 "There is no data" 가 온다.
set -euo pipefail
URL="${HTTP_WEB_SERVER_URL:-http://127.0.0.1:8082}"
out=$(curl -s -m 10 -w '\n%{http_code}' "$URL/ARS/History/SEWT_SMOKE/99999" || true)
code="${out##*$'\n'}"
body="${out%$'\n'*}"
echo "HTTP $code ${body:0:80}"
if [[ "$code" != "500" || "$body" != *"There is no data"* ]]; then
  echo "FAIL: 이력 서버가 기대한 답(500 There is no data)을 주지 않음 — docker compose -f infra/docker-compose.yml logs http-web-server"
  exit 1
fi
echo "OK"
