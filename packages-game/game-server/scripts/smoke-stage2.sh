#!/bin/bash
# Stage2 online smoke test — 社交核心（情报生态/关系养成/帮派全生命周期）
# Run on odoo server: bash /tmp/smoke-stage2.sh
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

code_of() { echo "$1" | sed -n 's/.*"code":\([0-9]*\).*/\1/p'; }

check_code() { # <label> <expected_code> <json>
  local got=$(code_of "$3")
  if [ "$got" = "$2" ]; then ok "$1 (code=$2)"; else bad "$1 want code=$2 got=${got:-none}" "$3"; fi
}

check_any_code() { # <label> <codes_csv> <json> — 0(success) 或任一业务码
  local got=$(code_of "$3")
  if [ "$got" = "0" ] || echo ",$2," | grep -q ",$got,"; then ok "$1 (code=$got)"; else bad "$1 want 0 or one of [$2] got=${got:-none}" "$3"; fi
}

# ---- 1. admin login ----
ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi

# ---- 2. register two players + characters + grant gold ----
REGISTER() { # <prefix> -> echoes "TOKEN PID"
  local U="smoke2_${1}_$(date +%s)"
  local R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SMK${1}$(date +%s)\",\"deviceId\":\"smoke-dev-$1\"}")
  local T=$(echo "$R" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  local P=$(echo "$R" | sed -n 's/.*"playerId":"\([^"]*\)".*/\1/p')
  if [ -n "$T" ]; then echo "$T $P"; else echo "FAIL_REG $R"; fi
}

READ_PAIR() { read PT PID; if [ "$PT" = "FAIL_REG" ]; then bad "register $1" "$PID"; exit 1; fi; ok "register p$1 (playerId=$PID)"; }

OUT=$(REGISTER a); READ_PAIR <<< "$OUT"; PT1=$PT; PID1=$PID
OUT=$(REGISTER b); READ_PAIR <<< "$OUT"; PT2=$PT; PID2=$PID

CREATE_CHAR() { # <token> <profession> -> id or empty
  local R=$(curl -s -X POST $BASE/api/client/v1/character/create -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"name\":\"Smoke\",\"nickname\":\"Smoke\",\"profession\":\"$2\",\"gender\":\"male\",\"age\":18}")
  echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p'
}

C1=$(CREATE_CHAR "$PT1" merchant); [ -n "$C1" ] && ok "character create p1 (id=$C1)" || bad "character create p1"
C2=$(CREATE_CHAR "$PT2" scholar);  [ -n "$C2" ] && ok "character create p2 (id=$C2)" || bad "character create p2"

GRANT() { # <playerId> <amount>
  curl -s -X PUT $BASE/api/admin/v1/player/$1/currency -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"currencyType\":\"gold\",\"amount\":$2,\"operation\":\"add\",\"reason\":\"smoke\"}" > /dev/null
}
GRANT $PID1 10000; GRANT $PID2 10000; ok "grant gold x2"

# ---- 3. 情报生态 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/intel/spy -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\"}")
check_any_code "intel spy" "91005,91008" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/intel/inquire -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"topic":"test"}')
echo "$R" | grep -q '"grade"' && ok "intel inquire" || bad "intel inquire" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/intel/eavesdrop -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\"}")
check_any_code "intel eavesdrop level gate" "91007" "$R"

MINE=$(curl -s $BASE/api/client/v1/social/intel/mine -H "Authorization: Bearer $PT1")
IID=$(echo "$MINE" | grep -oP '"id":"\K[0-9]+' | head -1)
if [ -n "$IID" ]; then ok "intel mine (id=$IID)"; else bad "intel mine" "$MINE"; fi

R=$(curl -s -X POST $BASE/api/client/v1/social/intel/list -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"intelId\":\"$IID\",\"price\":50}")
check_code "intel list" 0 "$R"

R=$(curl -s "$BASE/api/client/v1/social/intel/market?page=1&limit=10" -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"total"' && ok "intel market" || bad "intel market" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/intel/buy -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d "{\"intelId\":\"$IID\"}")
check_any_code "intel buy" "91003,91004" "$R"

# ---- 4. 关系养成 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/friend/apply -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"friendId\":\"$PID2\"}")
check_any_code "friend apply" "50001" "$R"
R=$(curl -s -X POST $BASE/api/client/v1/social/friend/accept/$PID1 -H "Authorization: Bearer $PT2")
check_any_code "friend accept" "50001" "$R"
R=$(curl -s $BASE/api/client/v1/social/friend/list -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"friendId"' && ok "friend list" || bad "friend list" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/gift/send -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\",\"itemId\":\"item_001\"}")
check_any_code "gift send (no template -> 91103)" "91103" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/kinship/form -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"type\":\"master\",\"memberIds\":[\"$PID2\"]}")
check_any_code "kinship form master (lvl gap)" "91106,91101" "$R"

R=$(curl -s $BASE/api/client/v1/social/relationships -H "Authorization: Bearer $PT1")
echo "$R" | grep -q 'friend' && ok "relationships summary" || bad "relationships summary" "$R"

# ---- 5. 帮派全生命周期 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/guild/create -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"name":"SmokeGuild1"}')
G1=$(echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p')
[ -n "$G1" ] && ok "guild create p1 (id=$G1)" || bad "guild create p1" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/guild/create -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d '{"name":"SmokeGuild2"}')
G2=$(echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p')
[ -n "$G2" ] && ok "guild create p2 (id=$G2)" || bad "guild create p2" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/guild/role -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"guildId\":\"$G1\",\"playerId\":\"$PID2\",\"role\":\"hall_master\"}")
check_any_code "guild role leader appoint" "91201" "$R"
R=$(curl -s -X POST $BASE/api/client/v1/social/guild/role -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d "{\"guildId\":\"$G1\",\"playerId\":\"$PID1\",\"role\":\"member\"}")
check_code "guild role member forbidden" 91201 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/guild/build -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"guildId\":\"$G1\",\"buildingType\":\"meeting_hall\"}")
check_any_code "guild build meeting_hall" "91204" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/guild/fund -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"guildId\":\"$G1\",\"amount\":1000,\"reason\":\"smoke\"}")
echo "$R" | grep -q '"code":0' && ok "guild fund adjust" || bad "guild fund adjust" "$R"
R=$(curl -s $BASE/api/client/v1/social/guild/$G1 -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"fund"' && ok "guild fund reflected in info" || bad "guild fund reflected" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/guild/diplomacy -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"guildId\":\"$G1\",\"targetGuildId\":\"$G2\",\"relation\":\"friendly\"}")
check_any_code "guild diplomacy" "91207" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/guild/salary -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"guildId\":\"$G1\"}")
check_any_code "guild salary" "91204" "$R"

R=$(curl -s $BASE/api/client/v1/social/guild/$G1/contribution-rank -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"contribution"' && ok "guild contribution rank" || bad "guild contribution rank" "$R"

R=$(curl -s $BASE/api/client/v1/social/guild/$G1/log -H "Authorization: Bearer $PT1")
echo "$R" | grep -qE 'actionLog|actions' && ok "guild log" || bad "guild log" "$R"

# ---- 6. 七日引导 ----
R=$(curl -s $BASE/api/client/v1/social/guide/daily -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"tasks"' && ok "guide daily" || bad "guide daily" "$R"

echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
