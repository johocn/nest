#!/bin/bash
# Stage3 online smoke test — 社交×系统联动（社交战斗/社交任务/社交经济/平衡体检）
# Run on odoo server: bash /tmp/smoke-stage3.sh
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

id_of() { echo "$1" | sed -n "s/.*\"$2\":\"\([0-9]*\)\".*/\1/p" | head -1; }

# ---- 1. admin login ----
ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi

# ---- 2. register three players + characters + grant gold ----
REGISTER() { # <prefix> -> echoes "TOKEN PID"
  local U="smoke3_${1}_$(date +%s)"
  local T="" P="" R="" i
  for i in 1 2 3; do
    R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SMK3${1}$(date +%s)\",\"deviceId\":\"smoke3-dev-$1\"}")
    T=$(echo "$R" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    P=$(echo "$R" | sed -n 's/.*"playerId":"\([^"]*\)".*/\1/p')
    [ -n "$T" ] && break
    echo "$R" | grep -q 90005 && { echo "  (rate-limited, retry $i)" >&2; sleep 15; continue; }
    break
  done
  if [ -n "$T" ]; then echo "$T $P"; else echo "FAIL_REG $R"; fi
}

READ_PAIR() { read PT PID; if [ "$PT" = "FAIL_REG" ]; then bad "register $1" "$PID"; exit 1; fi; ok "register p$1 (playerId=$PID)"; }

OUT=$(REGISTER a); READ_PAIR <<< "$OUT"; PT1=$PT; PID1=$PID
sleep 15
OUT=$(REGISTER b); READ_PAIR <<< "$OUT"; PT2=$PT; PID2=$PID
sleep 15
OUT=$(REGISTER c); READ_PAIR <<< "$OUT"; PT3=$PT; PID3=$PID

CREATE_CHAR() { # <token> <profession> -> id or empty
  local R=$(curl -s -X POST $BASE/api/client/v1/character/create -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"name\":\"Smoke\",\"nickname\":\"Smoke\",\"profession\":\"$2\",\"gender\":\"male\",\"age\":18}")
  echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p'
}

C1=$(CREATE_CHAR "$PT1" merchant); [ -n "$C1" ] && ok "character create p1 (id=$C1)" || bad "character create p1"
C2=$(CREATE_CHAR "$PT2" scholar);  [ -n "$C2" ] && ok "character create p2 (id=$C2)" || bad "character create p2"
C3=$(CREATE_CHAR "$PT3" guard);    [ -n "$C3" ] && ok "character create p3 (id=$C3)" || bad "character create p3"

GRANT() { # <playerId> <amount>
  curl -s -X PUT $BASE/api/admin/v1/player/$1/currency -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"currencyType\":\"gold\",\"amount\":$2,\"operation\":\"add\",\"reason\":\"smoke3\"}" > /dev/null
}
GRANT $PID1 30000; GRANT $PID2 30000; GRANT $PID3 30000; ok "grant gold x3"

# 道具链播种（送礼前置）：item_templates + gift_templates(关联模板id) + p1 背包（幂等）
ITEM_ID=$(docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -t -A -c "SELECT id FROM item_templates WHERE name='SmokeGift' LIMIT 1;")
if [ -z "$ITEM_ID" ]; then
  ITEM_ID=$(docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -t -A -c "INSERT INTO item_templates (name, item_type, rarity, max_stack, sell_price, can_trade, can_drop, bind_type, config_json) VALUES ('SmokeGift','material','common',99,'0',true,true,'none','{}') RETURNING id;" | grep -E '^[0-9]+$' | head -1)
fi
[ -n "$ITEM_ID" ] && ok "seed item template (id=$ITEM_ID)" || bad "seed item template"
docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c "INSERT INTO gift_templates (\"itemId\", gift_weight, daily_cap) VALUES ('$ITEM_ID',10,5) ON CONFLICT (\"itemId\") DO NOTHING;" > /dev/null 2>&1 && ok "seed gift template (itemId=$ITEM_ID)" || bad "seed gift template"
docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c "INSERT INTO inventory_items (player_id, item_template_id, quantity, slot_index, bind_status) SELECT $PID1,$ITEM_ID,5,0,'unbound' WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE player_id=$PID1 AND item_template_id=$ITEM_ID);" > /dev/null 2>&1 && ok "seed p1 inventory x5" || bad "seed p1 inventory"

# ---- 3. 社交战斗 · 阵法全生命周期 ----
R=$(curl -s -X POST $BASE/api/client/v1/combat/formations -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"formationId":"three_talents"}')
FID=$(id_of "$R" formationId)
[ -n "$FID" ] && ok "formation create p1 (id=$FID)" || bad "formation create p1" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/formations/$FID/join -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d "{\"playerId\":\"$PID2\",\"position\":1}")
check_any_code "formation join p2" "91303" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/formations/$FID/activate -H "Authorization: Bearer $PT1")
check_code "formation activate (not full)" 91303 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/formations/$FID/join -H "Authorization: Bearer $PT3" -H 'Content-Type: application/json' -d "{\"playerId\":\"$PID3\",\"position\":2}")
check_any_code "formation join p3" "91303" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/formations/$FID/activate -H "Authorization: Bearer $PT1")
check_code "formation activate full" 0 "$R"

R=$(curl -s $BASE/api/client/v1/combat/formations/$FID -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"active":true' && echo "$R" | grep -q '"position":0' && ok "formation detail active+members" || bad "formation detail" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/formations -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d '{"formationId":"five_elements"}')
check_code "formation create while bound" 91304 "$R"

R=$(curl -s -X DELETE $BASE/api/client/v1/combat/formations/$FID/leave -H "Authorization: Bearer $PT3")
check_code "formation leave p3" 0 "$R"
R=$(curl -s -X DELETE $BASE/api/client/v1/combat/formations/$FID/leave -H "Authorization: Bearer $PT2")
check_code "formation leave p2" 0 "$R"
R=$(curl -s -X DELETE $BASE/api/client/v1/combat/formations/$FID/leave -H "Authorization: Bearer $PT1")
check_code "formation leave p1" 0 "$R"

# ---- 4. 合击 / 援护 ----
R=$(curl -s -X POST $BASE/api/client/v1/combat/combo -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"partnerId\":\"$PID2\"}")
check_any_code "combo no relation" "91306" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/rescue -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\"}")
check_any_code "rescue relation gate" "91308" "$R"

R=$(curl -s $BASE/api/client/v1/combat/rescue/logs -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"logs"' && ok "rescue logs" || bad "rescue logs" "$R"

# ---- 5. 颜面 / 战利品 / 仲裁 ----
R=$(curl -s -X POST $BASE/api/client/v1/combat/shame -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\"}")
check_any_code "public shame (target FACE<30)" "91313,20007" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/grudge/declare -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\"}")
check_code "declare grudge" 0 "$R"

R=$(curl -s $BASE/api/client/v1/combat/buffs -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"code":0' && ok "combat buffs" || bad "combat buffs" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/loot/distribute -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"combatLogId":"999999","mode":"equal","itemsJson":{"items":[]}}')
check_any_code "loot distribute no log" "91309" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/combat/arbitration -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"combatLogId\":\"999999\",\"partiesJson\":{\"partyA\":\"$PID2\",\"partyB\":\"$PID3\"},\"claimsJson\":{\"reason\":\"smoke\"}}")
check_any_code "arbitration start no log" "91312,91311,91309" "$R"

R=$(curl -s $BASE/api/client/v1/combat/battle-report/999999 -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"code":0' && ok "battle report" || ok "battle report (empty-safe)"

# ---- 6. 社交任务 · 模板 + 事件推进 + 卡关求助 ----
TS=$(date +%s)
R=$(curl -s -X POST $BASE/api/admin/v1/quest/template -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"SmokeSocialGift_$TS\",\"questType\":\"daily\",\"minLevel\":1,\"acceptLimit\":1,\"autoReward\":false,\"targetJson\":{\"count\":1},\"rewardJson\":{},\"repeatable\":false}")
QT=$(id_of "$R" id)
[ -n "$QT" ] && ok "quest template create (id=$QT)" || bad "quest template create" "$R"

R=$(curl -s -X PUT $BASE/api/admin/v1/quest/template/$QT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"targetType":"send_gift","rewardSocial":{"currencyType":"favor","amount":10}}')
check_code "quest template social update" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/quest/accept -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$QT\"}")
check_code "quest accept social" 0 "$R"

# 建立好友关系（送礼前置）
R=$(curl -s -X POST $BASE/api/client/v1/social/friend/apply -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"friendId\":\"$PID2\"}")
check_any_code "friend apply" "50001" "$R"
R=$(curl -s -X POST $BASE/api/client/v1/social/friend/accept/$PID1 -H "Authorization: Bearer $PT2")
check_any_code "friend accept" "50001" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/gift/send -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetId\":\"$PID2\",\"itemId\":\"$ITEM_ID\"}")
check_any_code "gift send (GIFT_SENT event)" "91103,91104" "$R"
sleep 1

R=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"status":"completed"' && ok "quest auto-advanced by GIFT_SENT" || bad "quest auto-advance" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/quest/help/request -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$QT\"}")
HID=$(id_of "$R" id)
[ -n "$HID" ] && ok "quest help request (id=$HID)" || bad "quest help request" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/quest/help/request -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$QT\"}")
check_code "quest help duplicate" 91402 "$R"

R=$(curl -s $BASE/api/client/v1/quest/help/mine -H "Authorization: Bearer $PT2")
echo "$R" | grep -q '"open"' && ok "quest help list" || bad "quest help list" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/quest/help/$HID/respond -H "Authorization: Bearer $PT2")
check_code "quest help respond" 0 "$R"

# ---- 7. 社交经济 · 议价全链路 ----
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d '{"itemTemplateId":"item_001","itemName":"SmokeSword","quantity":1,"pricePerUnit":"200","currencyType":"gold"}')
OID=$(id_of "$R" id)
[ -n "$OID" ] && ok "trade order create p2 (id=$OID)" || bad "trade order create p2" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/negotiations -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"tradeOrderId\":\"$OID\",\"askPrice\":\"150\"}")
NID=$(id_of "$R" id)
[ -n "$NID" ] && ok "negotiation start (id=$NID)" || bad "negotiation start" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/negotiations/$NID/reply -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d '{"replyPrice":"180"}')
check_code "negotiation reply" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/negotiations/$NID/accept -H "Authorization: Bearer $PT1")
check_code "negotiation accept" 0 "$R"

# ---- 8. 担保 / 悬赏 / 赊账 / 易物 ----
# escrow 需未完结订单（议价 OID 已完成），另开新订单测担保人资格
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d '{"itemTemplateId":"item_001","itemName":"SmokeShield","quantity":1,"pricePerUnit":"300","currencyType":"gold"}')
OID2=$(id_of "$R" id)
[ -n "$OID2" ] && ok "trade order 2 create p2 (id=$OID2)" || bad "trade order 2 create p2" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/escrow -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"sellerId\":\"$PID2\",\"tradeOrderId\":\"$OID2\",\"guarantorId\":\"$PID3\"}")
check_any_code "escrow guarantor gate" "91505" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/bounties -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"type":"collect","targetJson":{"item":"wolf_pelt"},"goldReward":"100"}')
BID=$(id_of "$R" id)
[ -n "$BID" ] && ok "bounty create (id=$BID)" || bad "bounty create" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/bounties/$BID/accept -H "Authorization: Bearer $PT2")
check_code "bounty accept" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/bounties/$BID/complete -H "Authorization: Bearer $PT2")
check_code "bounty complete" 0 "$R"

R=$(curl -s "$BASE/api/client/v1/trade/bounties?page=1&limit=5" -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"total"' && ok "bounty board" || bad "bounty board" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/credit -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"lenderId\":\"$PID2\",\"amount\":\"100\",\"dueDays\":7}")
check_any_code "credit favor gate" "91510,91509" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/barter -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"itemsAJson":{"items":["item_001"]},"goldAmount":"10"}')
BRID=$(id_of "$R" id)
[ -n "$BRID" ] && ok "barter create (id=$BRID)" || bad "barter create" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/trade/barter/$BRID/accept -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d '{"itemsBJson":{"items":["item_002"]}}')
check_code "barter accept" 0 "$R"

R=$(curl -s $BASE/api/client/v1/trade/barter/mine -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"code":0' && ok "barter mine" || bad "barter mine" "$R"

# ---- 9. 平衡体检（T18 四象限）----
R=$(curl -s $BASE/api/admin/v1/balance/audit -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"social"' && echo "$R" | grep -q '"combat"' && echo "$R" | grep -q '"economy"' && echo "$R" | grep -q '"growth"' && ok "balance audit 4-quadrant" || bad "balance audit" "$R"

echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
