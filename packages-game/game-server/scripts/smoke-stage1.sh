#!/bin/bash
# Stage1 online smoke test (run on odoo server)
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

check_code() { # <label> <expected_code> <json>
  local got=$(echo "$3" | sed -n 's/.*"code":\([0-9]*\).*/\1/p')
  if [ "$got" = "$2" ]; then ok "$1 (code=$2)"; else bad "$1 want code=$2 got=${got:-none}" "$3"; fi
}

# ---- 1. admin login ----
ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi

# ---- 2. player register ----
U="smoke_$(date +%s)"
REG=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SMK$(date +%s)\",\"deviceId\":\"smoke-dev\"}")
PT=$(echo "$REG" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
PID=$(echo "$REG" | sed -n 's/.*"playerId":"\([^"]*\)".*/\1/p')
if [ -n "$PT" ]; then ok "player register (playerId=$PID)"; else bad "player register" "$REG"; exit 1; fi

# ---- 2.5 create character ----
CR=$(curl -s -X POST $BASE/api/client/v1/character/create -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"name":"Smoke","nickname":"Smoke","profession":"merchant","gender":"male","age":18}')
CID=$(echo "$CR" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -n "$CID" ]; then ok "character create (id=$CID)"; else bad "character create" "$CR"; fi

# ---- 2.6 grant diamond (admin) ----
GR=$(curl -s -X PUT $BASE/api/admin/v1/player/$PID/currency -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"currencyType":"diamond","amount":100,"operation":"add","reason":"smoke"}')
echo "$GR" | grep -qP '"code":(?!0)' && bad "grant diamond" "$GR" || ok "grant diamond 100"

# ---- 3. economy ----
R=$(curl -s -X POST $BASE/api/client/v1/economy/exchange -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"from":"diamond","to":"bound_diamond","amount":10}')
echo "$R" | grep -q 'balanceAfter' && ok "exchange diamond->bound_diamond" || bad "exchange diamond->bound_diamond" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/economy/exchange -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"from":"favor","to":"gold","amount":10}')
check_code "exchange favor->gold blocked(20009)" 20009 "$R"

R=$(curl -s $BASE/api/client/v1/economy/social/balances -H "Authorization: Bearer $PT")
echo "$R" | grep -qE '"(favor|guildContrib|face)"' && ok "social balances" || bad "social balances" "$R"

# ---- 4. character card ----
R=$(curl -s -X PUT $BASE/api/client/v1/character/card -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"alias":"Xiaoyao"}' )
echo "$R" | grep -q 'alias' && ok "character card set alias" || bad "character card" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/character/titles/equip -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"titleId":"not-owned-1","equip":true}')
check_code "titles equip not owned(50009)" 50009 "$R"

if [ -n "$CID" ]; then
  R=$(curl -s $BASE/api/client/v1/character/card/$CID -H "Authorization: Bearer $PT")
  echo "$R" | grep -q 'alias' && ok "character card view" || bad "character card view" "$R"
fi

# ---- 5. world ----
R=$(curl -s -X POST $BASE/api/client/v1/world/objects/999999/interact -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"interactType":"camp"}')
echo "$R" | grep -q '"code"' && ok "world objects interact route live (business code)" || bad "world objects interact" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/world/triggers/999999/activate -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"memberIds":[]}')
echo "$R" | grep -q '"code"' && ok "world triggers activate route live" || bad "world triggers activate" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/world/games/start -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"gameId":"1","betAmount":100}')
check_code "world games start not found(50013)" 50013 "$R"

# ---- 6. auth security ----
R=$(curl -s $BASE/api/client/v1/auth/security-status -H "Authorization: Bearer $PT")
echo "$R" | grep -qE '"(mutedUntil|tradeLockedUntil|realNameBound)"' && ok "auth security-status" || bad "auth security-status" "$R"

# ---- 7. GM gate: player token must be rejected ----
R=$(curl -s -X POST $BASE/api/admin/v1/auth/penalties -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"playerId":"x","level":"warn","reason":"t"}')
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/admin/v1/auth/penalties -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"playerId":"x","level":"warn","reason":"t"}')
[ "$HTTP" = "401" ] && ok "GM penalties rejects player (401)" || bad "GM penalties player gate http=$HTTP" "$R"

# ---- 8. admin GM read (penalty list) ----
R=$(curl -s $BASE/api/admin/v1/auth/penalties/$PID -H "Authorization: Bearer $ADMIN_TOKEN")
[ -n "$R" ] && ok "GM penalties list (admin)" || bad "GM penalties list admin" "$R"

echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
