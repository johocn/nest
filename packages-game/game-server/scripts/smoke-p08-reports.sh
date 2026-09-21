#!/bin/bash
# P0-8 举报处置面板端到端「造数据」脚本
# Run on odoo server: BASE=http://127.0.0.1:3000 bash /tmp/smoke-p08-reports.sh
#
# 背景：生产 player_reports 只有 1 条历史数据且已是 processed，面板按设计仅对 pending
#       记录显示「处置」按钮，导致处置写动作无法端到端验证。本脚本用官方客户端 API
#       造 2 条待处置举报（A->B、B->A），并断言管理端台账接口（面板依赖的 {items,total}）。
# 随后在 https://game.joho.cn/admin 「举报处置」面板执行 IGNORE / WARN 处置并核对落库。
BASE=${BASE:-http://127.0.0.1:3000}
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

code_of() { echo "$1" | sed -n 's/.*"code":\([0-9]*\).*/\1/p'; }
id_of()   { echo "$1" | sed -n "s/.*\"$2\":\"\([0-9]*\)\".*/\1/p" | head -1; }

check_code() { # <label> <expected_code> <json>
  local got=$(code_of "$3")
  if [ "$got" = "$2" ]; then ok "$1 (code=$2)"; else bad "$1 want code=$2 got=${got:-none}" "$3"; fi
}

# ---- 1. 注册两个新账号（注册限流 5 次/60s：间隔 15s，命中 90005 重试）----
REGISTER() { # <tag> -> echoes "TOKEN PID"
  local U="p08_${1}_$(date +%s)"
  local T="" P="" R="" i
  for i in 1 2 3; do
    R=$(curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' \
      -d "{\"username\":\"$U\",\"password\":\"Smoke123!\",\"nickname\":\"P08${1}$(date +%s)\",\"deviceId\":\"p08-dev-$1\"}")
    T=$(echo "$R" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    P=$(echo "$R" | sed -n 's/.*"playerId":"\([^"]*\)".*/\1/p')
    [ -n "$T" ] && break
    echo "$R" | grep -q 90005 && { echo "  (rate-limited, retry $i)" >&2; sleep 15; continue; }
    break
  done
  if [ -n "$T" ]; then echo "$T $P"; else echo "FAIL_REG $R"; fi
}

READ_PAIR() { # <tag> < "TOKEN PID"
  local tag="$1"; read PT PID
  if [ "$PT" = "FAIL_REG" ]; then bad "register $tag" "$PID"; exit 1; fi
  ok "register $tag (playerId=$PID)"
}

OUT=$(REGISTER a); READ_PAIR a <<< "$OUT"; PT_A=$PT; PID_A=$PID
sleep 15
OUT=$(REGISTER b); READ_PAIR b <<< "$OUT"; PT_B=$PT; PID_B=$PID

# ---- 2. 双向举报：A->B(abuse) 与 B->A(ad)，期望均 code=0 且状态 pending ----
R1=$(curl -s -X POST $BASE/api/client/v1/social/report -H "Authorization: Bearer $PT_A" -H 'Content-Type: application/json' \
  -d "{\"targetType\":\"player\",\"targetId\":\"$PID_B\",\"reason\":\"abuse\",\"content\":\"P0-8 面板点检：A举报B\"}")
check_code "report A->B" 0 "$R1"
RID1=$(id_of "$R1" id)

R2=$(curl -s -X POST $BASE/api/client/v1/social/report -H "Authorization: Bearer $PT_B" -H 'Content-Type: application/json' \
  -d "{\"targetType\":\"player\",\"targetId\":\"$PID_A\",\"reason\":\"ad\",\"content\":\"P0-8 面板点检：B举报A\"}")
check_code "report B->A" 0 "$R2"
RID2=$(id_of "$R2" id)

# ---- 3. 管理端台账接口断言（面板依赖：data.items / data.total）----
ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$ADMIN_TOKEN" ] && ok "admin login" || { bad "admin login" "$ADMIN_LOGIN"; exit 1; }

LIST=$(curl -s "$BASE/api/admin/v1/community/reports?status=pending&page=1&limit=20" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$LIST" | grep -q '"items"' && ok "admin reports returns items" || bad "admin reports returns items" "$LIST"
echo "$LIST" | grep -q '"total"' && ok "admin reports returns total" || bad "admin reports returns total" "$LIST"
for rid in "$RID1" "$RID2"; do
  echo "$LIST" | grep -q "\"id\":\"$rid\"" && ok "pending list contains report #$rid" || bad "pending list contains report #$rid" "$LIST"
done

echo "----"
echo "PENDING_REPORTS=${RID1:-none},${RID2:-none}"
echo "PLAYERS A=$PID_A B=$PID_B"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1