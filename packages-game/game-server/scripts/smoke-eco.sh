#!/bin/bash
# =============================================================================
# E6a 生态联动冒烟测试（smoke-eco.sh）
# 覆盖：
#   1. 种子幂等      —— 执行 seed-social-tasks.sql 两次，断言 quest_templates 恒为 12 条
#   2. 玩家准备      —— 注册 3 玩家，SQL 给 p1/p2 绑定 sso_id（模拟 E1 SSO 建档结果）
#   3. 生态回调全链路 —— HMAC 签名 10 类 action / 篡改 91601 / 防重放 91602 /
#                       未知 action 91604 / 未绑定 ssoId 静默成功
#   4. 任务推进      —— view_article(种子任务) / activate_formation(阵法链路) /
#                       join_guild(帮派链路) / intel_buy(情报链路)
#   5. 浏览类日上限  —— view_article 日 10 次封顶，进度不再增加
# 运行（服务器 odoo 39.106.99.9，新代码部署之后）：
#   bash /tmp/smoke-eco.sh        # 需与 seed-social-tasks.sql 同目录
# 依赖：
#   - ECO_SHARED_SECRET 环境变量（systemd 服务从 .env.prod 注入），开头强校验
#   - 生产 PostgreSQL 容器 1Panel-postgresql-4LsS（用户 game，库 game_server）
#   - 无 jq，JSON 解析用 grep/sed（沿用 smoke-stage2/3.sh 风格）；与 smoke-stage2/3.sh 互不冲突
# 部署顺序建议：备份(pg_dump) -> 部署新代码 -> 重启 game-server -> 种子 -> 本冒烟
# =============================================================================

BASE=${SMOKE_BASE:-http://127.0.0.1:3000}
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

# 任务列表解析：按模板 name 定位任务，取 playerQuest.progress / playerQuest.status
quest_seg_of() { # <json> <name> -> 任务片段（"playerQuest":{...},"template":{...} 至 name 处）
  echo "$1" | grep -oP '\{"playerQuest":\{[^}]*\},\s*"template":\{[^}]*"name":"'"$2"'"' | head -1
}
quest_progress_of() { local s=$(quest_seg_of "$1" "$2"); [ -n "$s" ] && echo "$s" | grep -oP '"progress":\K[0-9]+' | head -1; }
quest_status_of()  { local s=$(quest_seg_of "$1" "$2"); [ -n "$s" ] && echo "$s" | grep -oP '"status":"\K[^"]+' | head -1; }

# ---- 0. 前置校验 ----
: "${ECO_SHARED_SECRET:?ERROR: 环境变量 ECO_SHARED_SECRET 未设置（服务器 .env.prod 注入 systemd）}"
SECRET="$ECO_SHARED_SECRET"

CONTAINER=1Panel-postgresql-4LsS
PSQL() { docker exec -e PGCLIENTENCODING=UTF8 "$CONTAINER" psql -U game -d game_server -t -A "$@"; }

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SEED_SQL="$SCRIPT_DIR/seed-social-tasks.sql"
if [ ! -f "$SEED_SQL" ]; then
  echo "FAIL: 未找到 $SEED_SQL（smoke-eco.sh 需与 seed-social-tasks.sql 同目录）"
  exit 1
fi

echo "==== E6a 生态联动冒烟 ==== base=$BASE"

# ---- 1. 种子幂等（seed-social-tasks.sh 同款逻辑，输出解析 social_seed_count）----
SEED_RUN() { # -> social_seed_count
  docker cp "$SEED_SQL" "$CONTAINER:/tmp/seed-social-tasks.sql"
  local OUT
  OUT=$(docker exec "$CONTAINER" psql -U game -d game_server -v ON_ERROR_STOP=1 -f /tmp/seed-social-tasks.sql 2>&1)
  echo "$OUT" | grep -A 2 'social_seed_count' | tail -1 | tr -d ' '
}
C1=$(SEED_RUN)
if [ "$C1" = "12" ]; then ok "seed social tasks x12 (首次执行)"; else bad "seed social tasks x12 (首次执行) got=$C1"; fi
C2=$(SEED_RUN)
if [ "$C2" = "12" ]; then ok "seed social tasks 幂等 x12 (重复执行)"; else bad "seed social tasks 幂等 got=$C2"; fi

# ---- 2. admin login（发金币用）----
ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi

# ---- 3. 注册 3 玩家 + 角色 + 金币 + sso 绑定（模拟 E1 SSO 建档结果）----
REGISTER() { # <prefix> -> echoes "TOKEN PID USERNAME"（注册限流 5 次/60s/IP，自动重试）
  local U="smoke_eco_${1}_$(date +%s)"
  local T="" P="" R="" i
  for i in 1 2 3; do
    R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"SMKE${1}$(date +%s)\",\"deviceId\":\"smoke-eco-dev-$1\"}")
    T=$(echo "$R" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    P=$(echo "$R" | sed -n 's/.*"playerId":"\([^"]*\)".*/\1/p')
    [ -n "$T" ] && break
    echo "$R" | grep -q 90005 && { echo "  (rate-limited, retry $i)" >&2; sleep 15; continue; }
    break
  done
  if [ -n "$T" ]; then echo "$T $P $U"; else echo "FAIL_REG $R"; fi
}

READ_PAIR() { # <prefix>
  read PT PID UNAME
  if [ "$PT" = "FAIL_REG" ]; then bad "register $1" "$PID"; exit 1; fi
  ok "register p$1 (playerId=$PID)"
}

OUT=$(REGISTER a); READ_PAIR <<< "$OUT"; PT1=$PT; PID1=$PID; U1=$UNAME
sleep 15
OUT=$(REGISTER b); READ_PAIR <<< "$OUT"; PT2=$PT; PID2=$PID; U2=$UNAME
sleep 15
OUT=$(REGISTER c); READ_PAIR <<< "$OUT"; PT3=$PT; PID3=$PID; U3=$UNAME

CREATE_CHAR() { # <token> <profession> -> id or empty
  local R=$(curl -s -X POST $BASE/api/client/v1/character/create -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"name\":\"Smoke\",\"nickname\":\"Smoke\",\"profession\":\"$2\",\"gender\":\"male\",\"age\":18}")
  echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p'
}

C1=$(CREATE_CHAR "$PT1" merchant); [ -n "$C1" ] && ok "character create p1 (id=$C1)" || bad "character create p1"
C2=$(CREATE_CHAR "$PT2" scholar);  [ -n "$C2" ] && ok "character create p2 (id=$C2)" || bad "character create p2"
C3=$(CREATE_CHAR "$PT3" guard);    [ -n "$C3" ] && ok "character create p3 (id=$C3)" || bad "character create p3"

GRANT() { # <playerId> <amount>
  curl -s -X PUT $BASE/api/admin/v1/player/$1/currency -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"currencyType\":\"gold\",\"amount\":$2,\"operation\":\"add\",\"reason\":\"smoke-eco\"}" > /dev/null
}
GRANT $PID1 30000; GRANT $PID2 30000; GRANT $PID3 30000; ok "grant gold x3"

# sso 绑定：auth_accounts 按 username 找 id，UPDATE sso_id（先清旧冒烟绑定防 unique 冲突）
PSQL "UPDATE auth_accounts SET sso_id=NULL WHERE sso_id IN ('smoke-eco-1','smoke-eco-2');"
PSQL "UPDATE auth_accounts SET sso_id='smoke-eco-1' WHERE username='$U1';"
PSQL "UPDATE auth_accounts SET sso_id='smoke-eco-2' WHERE username='$U2';"
B1=$(PSQL "SELECT count(*) FROM auth_accounts WHERE sso_id='smoke-eco-1';")
B2=$(PSQL "SELECT count(*) FROM auth_accounts WHERE sso_id='smoke-eco-2';")
if [ "$B1" = "1" ] && [ "$B2" = "1" ]; then ok "bind sso_id smoke-eco-1/2 (p1/p2)"; else bad "bind sso_id" "b1=$B1 b2=$B2"; fi

# ---- 4. 生态回调全链路（对玩家1 smoke-eco-1）----
SIGN() { # <body> <ts> -> hex(hmac_sha256(secret, body+"|"+ts))，与服务端 createHmac 一致
  printf '%s|%s' "$1" "$2" | openssl dgst -sha256 -hmac "$SECRET" -binary | od -An -tx1 | tr -d ' \n'
}
ECO_POST() { # <body> <ts> -> response json（rawBody 需与签名原文逐字节一致，用 --data-binary）
  local s=$(SIGN "$1" "$2")
  curl -s -X POST $BASE/api/client/v1/eco/events \
    -H 'Content-Type: application/json' \
    -H "X-Eco-Sign: $s" \
    -H "X-Eco-Ts: $2" \
    --data-binary "$1"
}

ACTIONS="view_article view_course view_product view_price view_activity join_activity like comment purchase distribute"
N=0
LAST_BODY=""; LAST_TS=""; LAST_SIGN=""
for A in $ACTIONS; do
  N=$((N+1))
  TS=$(date +%s)
  BODY="{\"action\":\"$A\",\"scope\":\"smoke\",\"ssoId\":\"smoke-eco-1\",\"targetId\":\"t$N\",\"extra\":{\"n\":$N}}"
  R=$(ECO_POST "$BODY" "$TS")
  check_code "eco $A (p1)" 0 "$R"
  LAST_BODY="$BODY"; LAST_TS="$TS"; LAST_SIGN=$(SIGN "$BODY" "$TS")
done

# 4.2 篡改签名：body 改动后沿用原签名重发 -> 91601
TAMPER_BODY="{\"action\":\"view_article\",\"scope\":\"smoke\",\"ssoId\":\"smoke-eco-1\",\"targetId\":\"tampered\",\"extra\":{}}"
R=$(curl -s -X POST $BASE/api/client/v1/eco/events -H 'Content-Type: application/json' -H "X-Eco-Sign: $LAST_SIGN" -H "X-Eco-Ts: $LAST_TS" --data-binary "$TAMPER_BODY")
check_code "eco tampered body -> 91601" 91601 "$R"

# 4.3 防重放：同 body+ts 原样重发（digest 命中 300s 锁）-> 91602
R=$(curl -s -X POST $BASE/api/client/v1/eco/events -H 'Content-Type: application/json' -H "X-Eco-Sign: $LAST_SIGN" -H "X-Eco-Ts: $LAST_TS" --data-binary "$LAST_BODY")
check_code "eco replay -> 91602" 91602 "$R"

# 4.4 未知 action -> 91604
TS=$(date +%s)
BODY='{"action":"unknown_act","scope":"smoke","ssoId":"smoke-eco-1","targetId":"t0","extra":{}}'
R=$(ECO_POST "$BODY" "$TS")
check_code "eco unknown action -> 91604" 91604 "$R"

# 4.5 未绑定 ssoId（不存在的 ssoId）-> 静默成功 code:0
TS=$(date +%s)
BODY="{\"action\":\"view_article\",\"scope\":\"smoke\",\"ssoId\":\"smoke-eco-none-$TS\",\"targetId\":\"t0\",\"extra\":{}}"
R=$(ECO_POST "$BODY" "$TS")
check_code "eco unbound ssoId silent (code=0)" 0 "$R"

# ---- 5. 任务推进 ----
# 5.1 初窥门径·浏览文章（view_article x3 -> 3/3 completed）
VA_ID=$(PSQL "SELECT id FROM quest_templates WHERE name='初窥门径·浏览文章' LIMIT 1;")
[ -n "$VA_ID" ] && ok "locate seed quest 初窥门径·浏览文章 (id=$VA_ID)" || bad "locate seed quest 初窥门径·浏览文章" "$VA_ID"
R=$(curl -s -X POST $BASE/api/client/v1/quest/accept -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$VA_ID\"}")
check_code "quest accept 初窥门径·浏览文章 (p1)" 0 "$R"
for i in 1 2 3; do
  TS=$(date +%s)
  BODY="{\"action\":\"view_article\",\"scope\":\"smoke\",\"ssoId\":\"smoke-eco-1\",\"targetId\":\"va$i\",\"extra\":{\"n\":$i}}"
  R=$(ECO_POST "$BODY" "$TS")
  check_code "eco view_article advance $i/3 (p1)" 0 "$R"
done
QL=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT1")
VP=$(quest_progress_of "$QL" "初窥门径·浏览文章")
VS=$(quest_status_of "$QL" "初窥门径·浏览文章")
if [ "$VP" = "3" ] && [ "$VS" = "completed" ]; then ok "view_article quest 3/3 completed"; else bad "view_article quest progress" "prog=$VP status=$VS"; fi

# 5.2 游戏内链路：结阵而战·激活阵法（activate_formation；复用 smoke-stage3 阵法全生命周期，
#     rescue/escrow 需关系/订单前置较深，阵法链路最稳，属于 seed 游戏内补充任务之一）
AF_ID=$(PSQL "SELECT id FROM quest_templates WHERE name='结阵而战·激活阵法' LIMIT 1;")
[ -n "$AF_ID" ] && ok "locate seed quest 结阵而战·激活阵法 (id=$AF_ID)" || bad "locate seed quest 结阵而战·激活阵法" "$AF_ID"
R=$(curl -s -X POST $BASE/api/client/v1/quest/accept -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$AF_ID\"}")
check_code "quest accept 结阵而战·激活阵法 (p1)" 0 "$R"

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
check_code "formation activate full (p1)" 0 "$R"

QL=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT1")
AP=$(quest_progress_of "$QL" "结阵而战·激活阵法")
AS=$(quest_status_of "$QL" "结阵而战·激活阵法")
if [ "$AP" = "1" ] && [ "$AS" = "completed" ]; then ok "activate_formation quest advanced by FORMATION_ACTIVATED"; else bad "activate_formation quest" "prog=$AP status=$AS"; fi

# 5.3 join_guild（复用 smoke-stage2 帮派链路：建帮即触发 GUILD_JOINED；
#     测试任务模板用 SQL 直插 quest_templates，与 seed 同列结构、带 target_type）
TS=$(date +%s)
JG_NAME="SmokeEcoGuild_$TS"
JG_ID=$(PSQL "INSERT INTO quest_templates (name, quest_type, min_level, accept_limit, auto_reward, target_json, reward_json, prerequisite_ids, target_type, prerequisite_social, reward_social, repeatable, created_at, updated_at) SELECT '$JG_NAME','daily',1,1,false,'{\"count\":1}'::jsonb,'{}'::jsonb,'{}'::int[],'join_guild',NULL::jsonb,NULL::jsonb,false,now(),now() WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE name='$JG_NAME') RETURNING id;" | grep -E '^[0-9]+$' | head -1)
[ -n "$JG_ID" ] && ok "insert quest tmpl join_guild (id=$JG_ID)" || bad "insert quest tmpl join_guild" "$JG_ID"
R=$(curl -s -X POST $BASE/api/client/v1/quest/accept -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$JG_ID\"}")
check_code "quest accept join_guild (p1)" 0 "$R"
R=$(curl -s -X POST $BASE/api/client/v1/social/guild/create -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"name\":\"SmokeEcoG1_$TS\"}")
G1=$(echo "$R" | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p')
[ -n "$G1" ] && ok "guild create p1 (id=$G1)" || bad "guild create p1" "$R"
QL=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT1")
GP=$(quest_progress_of "$QL" "$JG_NAME")
GS=$(quest_status_of "$QL" "$JG_NAME")
if [ "$GP" = "1" ] && [ "$GS" = "completed" ]; then ok "join_guild quest advanced by GUILD_JOINED"; else bad "join_guild quest" "prog=$GP status=$GS"; fi

# 5.4 intel_buy（复用 smoke-stage2 情报链路：p1 打听产情报->挂单，p2 购买触发 INTEL_BOUGHT）
TS=$(date +%s)
IB_NAME="SmokeEcoIntel_$TS"
IB_ID=$(PSQL "INSERT INTO quest_templates (name, quest_type, min_level, accept_limit, auto_reward, target_json, reward_json, prerequisite_ids, target_type, prerequisite_social, reward_social, repeatable, created_at, updated_at) SELECT '$IB_NAME','daily',1,1,false,'{\"count\":1}'::jsonb,'{}'::jsonb,'{}'::int[],'intel_buy',NULL::jsonb,NULL::jsonb,false,now(),now() WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE name='$IB_NAME') RETURNING id;" | grep -E '^[0-9]+$' | head -1)
[ -n "$IB_ID" ] && ok "insert quest tmpl intel_buy (id=$IB_ID)" || bad "insert quest tmpl intel_buy" "$IB_ID"
R=$(curl -s -X POST $BASE/api/client/v1/quest/accept -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$IB_ID\"}")
check_code "quest accept intel_buy (p2)" 0 "$R"

R=$(curl -s -X POST $BASE/api/client/v1/social/intel/inquire -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d '{"topic":"eco-smoke"}')
echo "$R" | grep -q '"grade"' && ok "intel inquire (p1)" || bad "intel inquire" "$R"
MINE=$(curl -s $BASE/api/client/v1/social/intel/mine -H "Authorization: Bearer $PT1")
IID=$(echo "$MINE" | grep -oP '"id":"\K[0-9]+' | head -1)
if [ -n "$IID" ]; then ok "intel mine (id=$IID)"; else bad "intel mine" "$MINE"; fi
R=$(curl -s -X POST $BASE/api/client/v1/social/intel/list -H "Authorization: Bearer $PT1" -H 'Content-Type: application/json' -d "{\"intelId\":\"$IID\",\"price\":50}")
check_code "intel list (p1)" 0 "$R"
R=$(curl -s -X POST $BASE/api/client/v1/social/intel/buy -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d "{\"intelId\":\"$IID\"}")
check_code "intel buy (p2)" 0 "$R"
QL=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT2")
IP=$(quest_progress_of "$QL" "$IB_NAME")
IS=$(quest_status_of "$QL" "$IB_NAME")
if [ "$IP" = "1" ] && [ "$IS" = "completed" ]; then ok "intel_buy quest advanced by INTEL_BOUGHT"; else bad "intel_buy quest" "prog=$IP status=$IS"; fi

# ---- 6. 浏览类日上限（玩家2 smoke-eco-2；view_article 日限 10 次）----
TS=$(date +%s)
CAP_NAME="SmokeEcoCap_$TS"
CAP_ID=$(PSQL "INSERT INTO quest_templates (name, quest_type, min_level, accept_limit, auto_reward, target_json, reward_json, prerequisite_ids, target_type, prerequisite_social, reward_social, repeatable, created_at, updated_at) SELECT '$CAP_NAME','daily',1,1,false,'{\"count\":20}'::jsonb,'{}'::jsonb,'{}'::int[],'view_article',NULL::jsonb,NULL::jsonb,false,now(),now() WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE name='$CAP_NAME') RETURNING id;" | grep -E '^[0-9]+$' | head -1)
[ -n "$CAP_ID" ] && ok "insert quest tmpl view_article x20 (id=$CAP_ID)" || bad "insert quest tmpl view_article x20" "$CAP_ID"
R=$(curl -s -X POST $BASE/api/client/v1/quest/accept -H "Authorization: Bearer $PT2" -H 'Content-Type: application/json' -d "{\"questTemplateId\":\"$CAP_ID\"}")
check_code "quest accept daily-cap x20 (p2)" 0 "$R"

# 回调 11 次：body 每次不同（targetId 递增），防重放 key=sha256(body|ts) 各不同，同秒连发即可
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  TS=$(date +%s)
  BODY="{\"action\":\"view_article\",\"scope\":\"smoke\",\"ssoId\":\"smoke-eco-2\",\"targetId\":\"cap$i\",\"extra\":{\"n\":$i}}"
  R=$(ECO_POST "$BODY" "$TS")
  code_of "$R" > /dev/null   # 第 1-10 次推进、第 11 次被日上限拦截；进度统一在下方断言
done
QL=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT2")
LP=$(quest_progress_of "$QL" "$CAP_NAME")
if [ "$LP" = "10" ]; then ok "eco view_article daily cap: 11 calls -> progress 10/20"; else bad "eco view_article daily cap" "prog=$LP want 10"; fi

# 再发 1 次（累计第 12 次）确认进度不再增加
TS=$(date +%s)
BODY='{"action":"view_article","scope":"smoke","ssoId":"smoke-eco-2","targetId":"cap12","extra":{"n":12}}'
R=$(ECO_POST "$BODY" "$TS")
QL=$(curl -s $BASE/api/client/v1/quest/list -H "Authorization: Bearer $PT2")
LP2=$(quest_progress_of "$QL" "$CAP_NAME")
if [ "$LP2" = "10" ]; then ok "eco view_article daily cap stays 10 (12th call)"; else bad "eco view_article daily cap stable" "prog=$LP2 want 10"; fi

# ---- 7. 汇总 ----
echo "=============================="
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
