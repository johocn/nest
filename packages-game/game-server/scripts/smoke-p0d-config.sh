#!/bin/bash
# P0-4 配置字段生效冒烟 · 任务门槛/奖励、活动条件/人数上限、公告时间窗
# Run on odoo: ADMIN_PASS 自动来自 .env.prod
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

# 提取 JSON 字符串字段（bigint id 亦序列化为字符串）
jstr() { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }
# 断言 body 内 code 等于期望值
want_code() { echo "$2" | grep -qE "\"code\"[[:space:]]*:[[:space:]]*$3" && ok "$1" || bad "$1 (want code=$3)" "$2"; }

ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(jstr "$ADMIN_LOGIN" token)
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi
AT="Authorization: Bearer $ADMIN_TOKEN"

TS=$(date +%s)
START_ISO=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%S.000Z)
END_ISO=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%S.000Z)
FUTURE_ISO=$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%S.000Z)

# 注册测试号（注册限流 5 次/60s，第二个号间隔 15s）
reg() {
  curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"Smoke123!\",\"nickname\":\"$1\",\"deviceId\":\"p0d-dev\"}"
}
U1="p0d_a_$TS"; U2="p0d_b_$TS"
R=$(reg "$U1"); T1=$(jstr "$R" token); P1=$(jstr "$R" playerId)
[ -n "$T1" ] && ok "register A (player=$P1)" || bad "register A" "$R"
sleep 15
R=$(reg "$U2"); T2=$(jstr "$R" token); P2=$(jstr "$R" playerId)
[ -n "$T2" ] && ok "register B (player=$P2)" || bad "register B" "$R"
P1T="Authorization: Bearer $T1"
P2T="Authorization: Bearer $T2"

quest_tpl() {  # $1=name $2=json 额外字段（含前导逗号）
  curl -s -X POST $BASE/api/admin/v1/quest/template -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"questType\":\"main\",\"minLevel\":1,\"acceptLimit\":99,\"autoReward\":true,\"repeatable\":true$2}"
}
quest_accept() { curl -s -X POST $BASE/api/client/v1/quest/accept -H "$1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$2\"}"; }
quest_submit() { curl -s -X POST $BASE/api/client/v1/quest/submit -H "$1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$2\"}"; }
quest_claim()  { curl -s -X POST $BASE/api/client/v1/quest/claim  -H "$1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$2\"}"; }

echo "== T1 任务前置链（prerequisite_ids 未完成 → 40001）=="
R=$(quest_tpl "P0D_PRE_$TS" ',"prerequisiteIds":[999999]')
Q_PRE=$(jstr "$R" id)
[ -n "$Q_PRE" ] && ok "create quest with prerequisite (id=$Q_PRE)" || bad "create quest prerequisite" "$R"
R=$(quest_accept "$P1T" "$Q_PRE")
want_code "accept blocked by prerequisite" "$R" 40001

echo "== T2 任务接取限次（accept_limit=1 → 二次接取 40003）=="
R=$(quest_tpl "P0D_LIMIT_$TS" ',"acceptLimit":1')
Q_LIM=$(jstr "$R" id)
[ -n "$Q_LIM" ] && ok "create quest accept_limit=1 (id=$Q_LIM)" || bad "create quest limit" "$R"
R=$(quest_accept "$P1T" "$Q_LIM")
echo "$R" | grep -q '"code":0' && ok "first accept within limit" || bad "first accept" "$R"
R=$(quest_accept "$P1T" "$Q_LIM")
want_code "second accept blocked by limit" "$R" 40003

echo "== T3 任务发奖两段（auto_reward=false：submit→completed，claim→余额增加）=="
R=$(quest_tpl "P0D_REWARD_$TS" ',"autoReward":false,"rewardJson":{"favor":5}')
Q_RW=$(jstr "$R" id)
[ -n "$Q_RW" ] && ok "create quest auto_reward=false (id=$Q_RW)" || bad "create quest reward" "$R"
BAL0=$(curl -s $BASE/api/client/v1/economy/social/balances -H "$P1T")
FAVOR0=$(jstr "$BAL0" favor)
R=$(quest_accept "$P1T" "$Q_RW")
echo "$R" | grep -q '"code":0' && ok "accept reward quest" || bad "accept reward quest" "$R"
R=$(quest_submit "$P1T" "$Q_RW")
echo "$R" | grep -q '"status":"completed"' && ok "submit returns status=completed" || bad "submit status" "$R"
R=$(quest_claim "$P1T" "$Q_RW")
echo "$R" | grep -q '"status":"claimed"' && ok "claim returns status=claimed" || bad "claim status" "$R"
BAL1=$(curl -s $BASE/api/client/v1/economy/social/balances -H "$P1T")
FAVOR1=$(jstr "$BAL1" favor)
if [ -n "$FAVOR1" ] && [ "$FAVOR1" != "$FAVOR0" ]; then
  ok "favor balance increased ($FAVOR0 -> $FAVOR1)"
else
  bad "favor balance increased (before=$FAVOR0 after=$FAVOR1)" "$BAL1"
fi
R=$(quest_claim "$P1T" "$Q_RW")
want_code "second claim rejected" "$R" 40004

activity_tpl() {  # $1=name $2=json 额外字段（含前导逗号）
  curl -s -X POST $BASE/api/admin/v1/activity/template -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"activityType\":\"limited_time\",\"startAt\":\"$START_ISO\",\"endAt\":\"$END_ISO\"$2}"
}
activity_publish() { curl -s -X POST $BASE/api/admin/v1/activity/$1/publish -H "$AT" -H 'Content-Type: application/json' -d '{}'; }
activity_join() { curl -s -X POST $BASE/api/client/v1/activity/$2/join -H "$1"; }

echo "== T4 活动参与条件（condition_json.level=99 → 60005）=="
R=$(activity_tpl "P0D_COND_$TS" ',"conditionJson":{"level":99}')
A_COND=$(jstr "$R" id)
[ -n "$A_COND" ] && ok "create activity with level condition (id=$A_COND)" || bad "create activity condition" "$R"
R=$(activity_publish "$A_COND")
echo "$R" | grep -q '"status":"active"' && ok "publish activity (active)" || bad "publish activity" "$R"
R=$(activity_join "$P1T" "$A_COND")
want_code "join blocked by level condition" "$R" 60005

echo "== T5 活动人数上限（max_participants=1 → 第二人 60006）=="
R=$(activity_tpl "P0D_FULL_$TS" ',"maxParticipants":1')
A_FULL=$(jstr "$R" id)
[ -n "$A_FULL" ] && ok "create activity max_participants=1 (id=$A_FULL)" || bad "create activity full" "$R"
R=$(activity_publish "$A_FULL")
echo "$R" | grep -q '"status":"active"' && ok "publish activity (active)" || bad "publish activity full" "$R"
R=$(activity_join "$P1T" "$A_FULL")
echo "$R" | grep -q '"code":0' && ok "first player joined" || bad "first player joined" "$R"
R=$(activity_join "$P2T" "$A_FULL")
want_code "second player blocked by capacity" "$R" 60006

notice_tpl() {  # $1=title $2=json 额外字段（含前导逗号）
  curl -s -X POST $BASE/api/admin/v1/notice -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"title\":\"$1\",\"content\":\"p0d smoke\",\"noticeType\":\"login\",\"isActive\":true,\"sortOrder\":0$2}"
}

echo "== T6 公告时间窗（start_at 为未来 → 不出现在 client list）=="
N_FUTURE="P0D_NOTICE_FUTURE_$TS"
N_NOW="P0D_NOTICE_NOW_$TS"
R=$(notice_tpl "$N_FUTURE" ",\"startAt\":\"$FUTURE_ISO\"")
echo "$R" | grep -q '"code":0' && ok "create future-window notice" || bad "create future notice" "$R"
R=$(notice_tpl "$N_NOW" "")
echo "$R" | grep -q '"code":0' && ok "create immediate notice" || bad "create immediate notice" "$R"
LIST=$(curl -s $BASE/api/client/v1/notice/list -H "$P1T")
echo "$LIST" | grep -q "$N_NOW" && ok "immediate notice visible" || bad "immediate notice visible" "$LIST"
echo "$LIST" | grep -q "$N_FUTURE" && bad "future notice should be hidden" "$LIST" || ok "future notice hidden"

echo "=============================="
echo "SMOKE P0-4 RESULT: PASS=$PASS FAIL=$FAIL"
