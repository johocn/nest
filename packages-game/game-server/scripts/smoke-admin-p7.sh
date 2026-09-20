#!/bin/bash
# P1-P5 管理端冒烟 · 风控/回放/同人多账号/宏观面/对账
# Run on odoo: ADMIN_PASS 自动来自 .env.prod
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi
AT="Authorization: Bearer $ADMIN_TOKEN"

# 注册一个测试号用于风控查询
U="adm_p7_$(date +%s)"
REG=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"ADMP7$(date +%s)\",\"deviceId\":\"adm-p7-dev\"}")
PID=$(echo "$REG" | sed -n 's/.*"playerId":"\([^"]*\)".*/\1/p')
[ -n "$PID" ] && ok "register test player (id=$PID)" || bad "register test player" "$REG"

field() { echo "$1" | sed -n "s/.*\"$2\":\([0-9a-zA-Z._\[\]\":{},-]*\)[\",}].*/BAD/p"; }

echo "== P1 风控管理 =="
R=$(curl -s $BASE/api/admin/v1/risk/cases -H "$AT")
echo "$R" | grep -q '"list"' && ok "risk listCases" || bad "risk listCases" "$R"

R=$(curl -s "$BASE/api/admin/v1/risk/players/$PID" -H "$AT")
echo "$R" | grep -qi "playerId\|riskScore\|score\|level\|data" && ok "risk playerScore" "$R" || bad "risk playerScore" "$R"

echo "== P2 回放校准 =="
R=$(curl -s -X POST $BASE/api/admin/v1/risk/replay -H "$AT" -H 'Content-Type: application/json' -d '{"since":"2026-09-19T00:00:00.000Z","until":"2026-09-20T23:59:59.999Z"}')
echo "$R" | grep -q '"hitAccounts"' && ok "risk replay empty window" "$R" || bad "risk replay" "$R"

echo "== P3 同人多账号关联 =="
R=$(curl -s "$BASE/api/admin/v1/risk/identity/player/$PID" -H "$AT")
echo "$R" | grep -q '"peers"\|"links"' && ok "identity graph" "$R" || bad "identity graph" "$R"

echo "== P4 经济宏观面 =="
R=$(curl -s $BASE/api/admin/v1/economy/dashboard -H "$AT")
echo "$R" | grep -q '"currencyStats"\|"address"\|"inFlow"\|"total"\|"top"' && ok "economy dashboard" || bad "economy dashboard" "$R"

echo "== P5 交易对账 =="
R=$(curl -s -X POST $BASE/api/admin/v1/reconcile/run -H "$AT" -H 'Content-Type: application/json' -d '{}')
echo "$R" | grep -q '"results"' && ok "reconcile run" || bad "reconcile run" "$R"
R=$(curl -s "$BASE/api/admin/v1/reconcile/results" -H "$AT")
echo "$R" | grep -q '"list"' && ok "reconcile results list" "$R" || bad "reconcile results" "$R"

echo "=============================="
echo "SMOKE ADMIN RESULT: PASS=$PASS FAIL=$FAIL"