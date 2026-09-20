#!/bin/bash
# Stage5 batch2 online smoke test — 社交经济闭环与商业化完善
# 覆盖：社交积分/宝箱/补签/充值状态机/新手保护/天梯/引导进度
# Run on odoo server: bash /tmp/smoke-stage5b.sh
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

code_of() { echo "$1" | sed -n 's/.*"code":\([0-9]*\).*/\1/p'; }

check_code() { # <label> <expected_code> <json>
  local got=$(code_of "$3")
  if [ "$got" = "$2" ]; then ok "$1 (code=$2)"; else bad "$1 want code=$2 got=${got:-none}" "$3"; fi
}

id_of() { echo "$1" | sed -n "s/.*\"$2\":\"\([0-9]*\)\".*/\1/p" | head -1; }
field_of() { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

# ---- 1. 注册两个玩家（间隔 sleep 15 防注册限流，重试 90005）----
REGISTER() { # <prefix> -> echoes "TOKEN PID"
  local U="s5b_${1}_$(date +%s)"
  local T="" P="" R="" i
  for i in 1 2 3; do
    R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SM5B${1}$(date +%s)\",\"deviceId\":\"smoke5b-dev-$1\"}")
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
A1="Authorization: Bearer $PT1"; A2="Authorization: Bearer $PT2"

# ---- 2. 社交积分：好友申请+接受 → 双方积分 >= 10 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/friend/apply -H "$A1" -H 'Content-Type: application/json' -d "{\"friendId\":\"$PID2\"}")
FR_ID=$(id_of "$R" id)
[ -n "$FR_ID" ] && ok "friend apply A->B (id=$FR_ID)" || bad "friend apply A->B" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/friend/accept/$PID1 -H "$A2")
check_code "friend accept B" 0 "$R"
# 积分由 FRIEND_ADDED 事件异步写入，等待落库后再断言
sleep 2

R=$(curl -s $BASE/api/client/v1/social/point/info -H "$A1")
BAL=$(echo "$R" | sed -n 's/.*"balance":\([0-9]*\).*/\1/p')
if [ "${BAL:-0}" -ge 10 ]; then ok "A social point balance >= 10 (balance=$BAL)"; else bad "A social point balance" "$R"; fi

# ---- 2.5 预置积分：兑换/补签链路前置，SQL 直插（余额聚合链路已在 2 验证，非本段被测目标） ----
docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c "INSERT INTO social_point_records (player_id, type, amount, balance_after, reason, ref_id) VALUES ('$PID1', 'earn', 90, 100, 'admin', 'smoke:preset')" >/dev/null && ok "preset 90 points for A" || bad "preset points" "sql"

# ---- 3. 宝箱：积分兑换 + 开启 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/point/exchange -H "$A1" -H 'Content-Type: application/json' -d '{"tier":1}')
CHEST_ID=$(id_of "$R" id)
[ -n "$CHEST_ID" ] && ok "exchange chest tier=1 (id=$CHEST_ID)" || bad "exchange chest" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/chest/$CHEST_ID/open -H "$A1")
echo "$R" | grep -q '"status":"opened"' && ok "open chest" || bad "open chest" "$R"

# ---- 4. 补签：昨日缺签 → makeup 成功 ----
YDAY=$(date -d '-1 day' +%F 2>/dev/null || date -v-1d +%F)
R=$(curl -s -X POST $BASE/api/client/v1/chat/sign-in/makeup -H "$A1" -H 'Content-Type: application/json' -d "{\"date\":\"$YDAY\"}")
echo "$R" | grep -q '"makeup":true' && ok "sign-in makeup $YDAY" || bad "sign-in makeup" "$R"

# ---- 5. 充值状态机：取首个商品创建订单 → 取消 ----
# payment 控制器路由无 /api 前缀（@Controller('payment')），完整路径 /payment/*
R=$(curl -s $BASE/payment/products -H "$A1")
PROD_ID=$(echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' | head -1)
[ -n "$PROD_ID" ] && ok "payment products (id=$PROD_ID)" || bad "payment products" "$R"

R=$(curl -s -X POST $BASE/payment/order/$PROD_ID -H "$A1")
ORDER_NO=$(field_of "$R" orderNo)
[ -n "$ORDER_NO" ] && ok "create order (orderNo=$ORDER_NO)" || bad "create order" "$R"

R=$(curl -s -X POST $BASE/payment/order/$ORDER_NO/cancel -H "$A1")
echo "$R" | grep -q '"status":"cancelled"' && ok "cancel order" || bad "cancel order" "$R"

# ---- 6. 新手保护：新注册玩家 protected=true ----
R=$(curl -s $BASE/api/client/v1/player/protection -H "$A1")
echo "$R" | grep -q '"protected":true' && ok "newbie protection on" || bad "newbie protection" "$R"

# ---- 7. 天梯：建档 1000 分 ----
R=$(curl -s $BASE/api/client/v1/ladder/info -H "$A1")
echo "$R" | grep -q '"score":1000' && ok "ladder info score=1000" || bad "ladder info" "$R"

# ---- 8. 引导进度：guide/daily 返回任务列表与统计 ----
R=$(curl -s $BASE/api/client/v1/social/guide/daily -H "$A1")
echo "$R" | grep -q '"tasks":\[' && echo "$R" | grep -q '"stats":{' && ok "guide daily" || bad "guide daily" "$R"

echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
