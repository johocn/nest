#!/bin/bash
# Stage5 online smoke test — 社交治理与发现（举报→台账处置→禁言生效 + 拉黑隔离 + 好友推荐）
# Run on odoo server: bash /tmp/smoke-stage5.sh
# 说明：聊天发言 chat.send 为 WebSocket-only 入口（src/modules/gateway/game.gateway.ts），
#       且 socket.io-client 为 devDependency（生产环境不可用），故本脚本不引入 WS 客户端：
#       - 禁言生效：由 GET /api/client/v1/auth/security-status 的 mutedUntil 验证
#         （chat 禁言校验与 security-status 同源于 AuthService.getAccountRestrictions）
#       - 私聊拉黑拦截（92203）：chat PRIVATE 频道前置要求互为好友且仅 WS 可达，
#         同源 isBlocked 拦截由 POST /api/client/v1/social/friend/apply 的 92203 断言
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

# ---- 1. admin login ----
ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi

# ---- 2. register three players A/B/C（间隔 sleep 15 防注册限流，重试 90005）----
REGISTER() { # <prefix> -> echoes "TOKEN PID"
  local U="smoke5_${1}_$(date +%s)"
  local T="" P="" R="" i
  for i in 1 2 3; do
    R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SMK5${1}$(date +%s)\",\"deviceId\":\"smoke5-dev-$1\"}")
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

# ---- 3. 举报：A 提交举报 B → 成功；24h 内重复 → 92204 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/report -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetType\":\"player\",\"targetId\":\"$PID2\",\"reason\":\"abuse\",\"content\":\"冒烟举报测试\"}")
RID=$(id_of "$R" id)
[ -n "$RID" ] && ok "report submit A->B (id=$RID)" || bad "report submit A->B" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/report -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"targetType\":\"player\",\"targetId\":\"$PID2\",\"reason\":\"abuse\",\"content\":\"重复举报\"}")
check_code "report duplicate in 24h" 92204 "$R"

# ---- 4. 拉黑：A 拉黑 C → 成功；拉黑自己 → 92201 ----
R=$(curl -s -X POST $BASE/api/client/v1/social/block -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"playerId\":\"$PID3\"}")
check_code "block C" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/block -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"playerId\":\"$PID1\"}")
check_code "block self rejected" 92201 "$R"

R=$(curl -s $BASE/api/client/v1/social/block/list -H "Authorization: Bearer $PT1")
echo "$R" | grep -q "$PID3" && ok "block list contains C" || bad "block list contains C" "$R"

# 拉黑拦截：C 申请加 A 好友 → 92203（与 chat PRIVATE 私聊拦截同源的 isBlocked 断言）
R=$(curl -s -X POST $BASE/api/client/v1/social/friend/apply -H "Authorization: Bearer $PT3" -H 'Content-Type: application/json' -d "{\"friendId\":\"$PID1\"}")
check_code "friend apply C->A blocked" 92203 "$R"

# ---- 5. 取消拉黑 → 恢复 ----
R=$(curl -s -X DELETE $BASE/api/client/v1/social/block/$PID3 -H "Authorization: Bearer $PT1")
check_code "unblock C" 0 "$R"

R=$(curl -s $BASE/api/client/v1/social/block/list -H "Authorization: Bearer $PT1")
echo "$R" | grep -q "$PID3" && bad "block list should be empty after unblock" "$R" || ok "block list empty after unblock"

R=$(curl -s -X POST $BASE/api/client/v1/social/friend/apply -H "Authorization: Bearer $PT3" -H 'Content-Type: application/json' -d "{\"friendId\":\"$PID1\"}")
check_code "friend apply C->A after unblock" 0 "$R"

# ---- 6. 好友推荐：数组、不含自己、字段结构 ----
R=$(curl -s "$BASE/api/client/v1/social/recommend/friends?limit=5" -H "Authorization: Bearer $PT1")
check_code "recommend friends" 0 "$R"
echo "$R" | grep -q '"data":\[' && ok "recommend returns array" || bad "recommend returns array" "$R"
echo "$R" | grep -q "\"playerId\":\"$PID1\"" && bad "recommend excludes self" "$R" || ok "recommend excludes self"
if echo "$R" | grep -q '"playerId":"[0-9]'; then
  echo "$R" | grep -q '"name"' && echo "$R" | grep -q '"score"' && echo "$R" | grep -q '"reason"' \
    && ok "recommend fields playerId/name/score/reason" || bad "recommend fields playerId/name/score/reason" "$R"
else
  ok "recommend empty (fields n/a)"
fi

# ---- 7. admin 台账含 A 的举报（targetId=B）→ 处置 MUTE 3600s ----
R=$(curl -s "$BASE/api/admin/v1/community/reports" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q "\"id\":\"$RID\"" && echo "$R" | grep -q "\"targetId\":\"$PID2\"" \
  && ok "admin report ledger contains report" || bad "admin report ledger" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/community/reports/$RID/handle -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"action":"MUTE","durationSeconds":3600,"remark":"冒烟处置：禁言一小时"}')
check_code "admin handle report MUTE" 0 "$R"
echo "$R" | grep -q '"handleAction":"MUTE"' && ok "report marked MUTE" || bad "report marked MUTE" "$R"

# ---- 8. B 禁言生效：chat.send 为 WS-only，改由 security-status 验证 mutedUntil ----
R=$(curl -s $BASE/api/client/v1/auth/security-status -H "Authorization: Bearer $PT2")
if echo "$R" | grep -q '"mutedUntil":null'; then
  bad "B muted effective (mutedUntil should be set)" "$R"
else
  echo "$R" | grep -q '"mutedUntil"' && ok "B muted effective (mutedUntil set)" || bad "B muted effective" "$R"
fi

echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
