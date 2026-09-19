#!/bin/bash
# Stage4 online smoke test — 运营与治理（活动工作台/社区运营/社交分析/聊天深化）
# Run on odoo server: bash /tmp/smoke-stage4.sh
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

# ---- 2. register three players + characters ----
REGISTER() { # <prefix> -> echoes "TOKEN PID"
  local U="smoke4_${1}_$(date +%s)"
  local T="" P="" R="" i
  for i in 1 2 3; do
    R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SMK4${1}$(date +%s)\",\"deviceId\":\"smoke4-dev-$1\"}")
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

# ---- 3. 活动工作台（4-1）：预配置→灰度→白名单可见→灰度通过→回滚 ----
START_AT=$(date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ)
END_AT=$(date -u -d '+7 day' +%Y-%m-%dT%H:%M:%SZ)

R=$(curl -s -X POST $BASE/api/admin/v1/activity/template -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"SmokeStage4_$(date +%s)\",\"activityType\":\"channel\",\"startAt\":\"$START_AT\",\"endAt\":\"$END_AT\",\"rewardJson\":{\"gold\":100}}")
AID=$(id_of "$R" id)
[ -n "$AID" ] && ok "activity template create (id=$AID)" || bad "activity template create" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/activity/$AID/publish -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"grayWhitelist\":{\"playerIds\":[\"$PID1\"]}}")
echo "$R" | grep -q '"status":"gray"' && ok "publish -> GRAY (whitelist)" || bad "publish -> GRAY" "$R"

R=$(curl -s $BASE/api/client/v1/activity/list -H "Authorization: Bearer $PT1")
echo "$R" | grep -q "\"id\":\"$AID\"" && ok "gray whitelist player sees activity" || bad "gray whitelist player sees activity" "$R"

R=$(curl -s $BASE/api/client/v1/activity/list -H "Authorization: Bearer $PT2")
echo "$R" | grep -q "\"id\":\"$AID\"" && bad "non-whitelist player should NOT see gray activity" "$R" || ok "non-whitelist player hidden (gray)"

R=$(curl -s -X POST $BASE/api/client/v1/activity/$AID/join -H "Authorization: Bearer $PT2")
check_code "join gray non-whitelist rejected" 91702 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/activity/$AID/join -H "Authorization: Bearer $PT1")
check_code "join gray whitelist ok" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/activity/$AID/join -H "Authorization: Bearer $PT1")
check_any_code "join duplicate" "60003" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/activity/$AID/gray-verify -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"passed":true}')
echo "$R" | grep -q '"status":"active"' && ok "gray-verify passed -> ACTIVE" || bad "gray-verify passed" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/activity/$AID/join -H "Authorization: Bearer $PT2")
check_code "join after ACTIVE ok" 0 "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/activity/$AID/rollback -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"status":"draft"' && ok "rollback -> DRAFT" || bad "rollback" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/activity/$AID/publish -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}')
echo "$R" | grep -q '"status":"active"' && ok "republish without whitelist -> ACTIVE" || bad "republish" "$R"

R=$(curl -s "$BASE/api/admin/v1/activity/$AID/dashboard?days=7" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"participantCount"' && echo "$R" | grep -q '"dailyTrend"' && ok "activity dashboard" || bad "activity dashboard" "$R"

# ---- 4. 配置版本历史 + 回滚（4-1）----
R=$(curl -s -X POST $BASE/api/admin/v1/config -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"key":"smoke.cfg","value":"v1","configType":"string"}')
check_code "config set v1" 0 "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/config -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"key":"smoke.cfg","value":"v2","configType":"string"}')
check_code "config set v2" 0 "$R"

R=$(curl -s "$BASE/api/admin/v1/config/smoke.cfg/versions" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"version":2' && ok "config versions has v2" || bad "config versions" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/config/smoke.cfg/rollback -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"version":1}')
check_code "config rollback to v1" 0 "$R"

R=$(curl -s $BASE/api/client/v1/config/smoke.cfg -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"value":"v1"' && ok "config value restored v1" || bad "config value restored" "$R"

# ---- 5. 社区运营（4-2）：公告互动 ----
R=$(curl -s -X POST $BASE/api/admin/v1/notice -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"title\":\"Smoke4Notice_$(date +%s)\",\"content\":\"冒烟公告\",\"noticeType\":\"popup\",\"isActive\":true,\"sortOrder\":1}")
NID=$(id_of "$R" id)
[ -n "$NID" ] && ok "notice create (id=$NID)" || bad "notice create" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/notice/$NID/react -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"type":"like"}')
check_code "notice react like" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/notice/$NID/react -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"type":"like"}')
check_code "notice react duplicate" 91901 "$R"

R=$(curl -s $BASE/api/client/v1/notice/$NID/reactions -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"likes":1' && ok "notice reactions count" || bad "notice reactions" "$R"

# ---- 6. 社区运营（4-2）：建议箱闭环 ----
R=$(curl -s -X POST $BASE/api/client/v1/community/feedback -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"category":"suggestion","content":"冒烟建议：希望增加钓鱼玩法"}')
FID=$(id_of "$R" id)
[ -n "$FID" ] && ok "feedback submit (id=$FID)" || bad "feedback submit" "$R"

R=$(curl -s $BASE/api/client/v1/community/feedback/my -H "Authorization: Bearer $PT1")
echo "$R" | grep -q "$FID" && ok "feedback my list" || bad "feedback my list" "$R"

R=$(curl -s "$BASE/api/admin/v1/community/feedback/list?status=pending" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q "$FID" && ok "feedback admin list" || bad "feedback admin list" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/community/feedback/$FID/handle -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"status":"accepted","reply":"已采纳，列入开发排期"}')
check_code "feedback handle" 0 "$R"

R=$(curl -s $BASE/api/client/v1/community/feedback/my -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"status":"accepted"' && ok "feedback player sees resolved" || bad "feedback player sees resolved" "$R"

# ---- 7. 社区运营（4-2）：玩家大使 ----
R=$(curl -s -X POST $BASE/api/admin/v1/community/ambassadors -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"playerId\":\"$PID1\",\"remark\":\"冒烟大使\"}")
AMB_ID=$(id_of "$R" id)
[ -n "$AMB_ID" ] && ok "ambassador appoint (id=$AMB_ID)" || bad "ambassador appoint" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/community/ambassadors -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"playerId\":\"$PID1\"}")
check_any_code "ambassador duplicate" "91903" "$R"

R=$(curl -s $BASE/api/client/v1/community/ambassadors -H "Authorization: Bearer $PT2")
echo "$R" | grep -q "$PID1" && ok "client active ambassadors" || bad "client active ambassadors" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/community/ambassadors/$AMB_ID/revoke -H "Authorization: Bearer $ADMIN_TOKEN")
check_code "ambassador revoke" 0 "$R"

# ---- 8. 社交数据分析（4-3）----
R=$(curl -s "$BASE/api/admin/v1/analytics/social/graph?limit=50" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"nodes"' && echo "$R" | grep -q '"edges"' && ok "social graph" || bad "social graph" "$R"

R=$(curl -s "$BASE/api/admin/v1/analytics/social/hubs?limit=10" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"code":0' && ok "social hubs" || bad "social hubs" "$R"

R=$(curl -s "$BASE/api/admin/v1/analytics/social/churn-risk?days=7" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"code":0' && ok "churn risk" || bad "churn risk" "$R"

R=$(curl -s "$BASE/api/admin/v1/analytics/social/funnel?days=7" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q '"newPlayerCount"' && echo "$R" | grep -q '"relationRate"' && ok "social funnel (7d relation rate)" || bad "social funnel" "$R"

# ---- 9. 聊天深化（4-4）：签到/热搜/幸运星/客服/语音房 ----
R=$(curl -s -X POST $BASE/api/client/v1/chat/sign-in -H "Authorization: Bearer $PT1")
check_code "chat sign-in" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/chat/sign-in -H "Authorization: Bearer $PT1")
check_code "chat sign-in duplicate" 92101 "$R"

R=$(curl -s $BASE/api/client/v1/chat/sign-in/status -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"signedIn":true' && ok "sign-in status" || bad "sign-in status" "$R"

R=$(curl -s $BASE/api/client/v1/chat/my-stats -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"code":0' && ok "my chat stats" || bad "my chat stats" "$R"

R=$(curl -s "$BASE/api/client/v1/chat/hot-topics?days=1" -H "Authorization: Bearer $PT1")
check_any_code "hot topics" "92105" "$R"

R=$(curl -s -X POST "$BASE/api/admin/v1/chat/lucky-star/draw?count=3&days=1" -H "Authorization: Bearer $ADMIN_TOKEN")
check_any_code "lucky star draw" "92106" "$R"

# 客服工单：SQL 播种一条 needs_gm 工单 → admin 回复闭环
TICKET_ID=$(docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -t -A -c "INSERT INTO support_tickets (player_id, channel, keyword, content, status, auto_reply, created_at) VALUES ('$PID1','world','GM','冒烟测试GM工单','needs_gm','已为您转接GM',NOW()) RETURNING id;" | grep -E '^[0-9]+$' | head -1)
[ -n "$TICKET_ID" ] && ok "seed support ticket (id=$TICKET_ID)" || bad "seed support ticket"

R=$(curl -s $BASE/api/client/v1/chat/support/my -H "Authorization: Bearer $PT1")
echo "$R" | grep -q "$TICKET_ID" && ok "support my tickets" || bad "support my tickets" "$R"

R=$(curl -s "$BASE/api/admin/v1/chat/support/list?status=needs_gm" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | grep -q "$TICKET_ID" && ok "support admin list" || bad "support admin list" "$R"

R=$(curl -s -X POST $BASE/api/admin/v1/chat/support/$TICKET_ID/reply -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"reply":"已处理，请查收"}')
check_code "support GM reply" 0 "$R"

R=$(curl -s $BASE/api/client/v1/chat/support/my -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"status":"resolved"' && ok "ticket resolved visible to player" || bad "ticket resolved" "$R"

# 语音房：创建/加入/列表/离开/空房清理
R=$(curl -s -X POST $BASE/api/client/v1/chat/voice-room -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"roomName":"冒烟茶馆","roomType":"tea_house","maxMembers":2}')
VRID=$(id_of "$R" id)
[ -n "$VRID" ] && ok "voice room create (id=$VRID)" || bad "voice room create" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/chat/voice-room/$VRID/join -H "Authorization: Bearer $PT2")
check_code "voice room join p2" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/chat/voice-room/$VRID/join -H "Authorization: Bearer $PT3")
check_code "voice room full" 92104 "$R"

R=$(curl -s "$BASE/api/client/v1/chat/voice-rooms?roomType=tea_house" -H "Authorization: Bearer $PT1")
echo "$R" | grep -q "$VRID" && ok "voice rooms list" || bad "voice rooms list" "$R"

R=$(curl -s -X POST $BASE/api/client/v1/chat/voice-room/$VRID/leave -H "Authorization: Bearer $PT2")
check_code "voice room leave p2" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/chat/voice-room/$VRID/leave -H "Authorization: Bearer $PT1")
echo "$R" | grep -q '"closed":true' && ok "voice room auto-close empty" || bad "voice room auto-close" "$R"

echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
