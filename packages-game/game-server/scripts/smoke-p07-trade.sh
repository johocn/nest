#!/bin/bash
# =============================================================================
# P0-7 交易经济结算冒烟（smoke-p07-trade.sh）
# 覆盖：
#   T0 准备    —— admin 登录、注册 2 玩家、造 3 个道具模板、直插库存与金币
#   T1 挂单托管 —— 挂单后卖家未绑定库存立即减少
#   T2 白名单  —— 社交货币/绑定钻 70008、禁交易模板 20005、全绑定堆 20003，且库存未被动
#   T3 成交结算 —— 买家扣款、卖家到手（扣 5% 税）、买家收货
#   T4 并发占位 —— 二次购买 70003，且买家未被二次扣款
#   T5 取消退货 —— 取消后托管库存原样退回
#   T6 拍卖    —— 上架托管 + 扣上架费 → 等定时任务结算 → 流拍退货
# 运行（服务器 odoo，新代码部署并重启之后）：
#   bash /tmp/smoke-p07-trade.sh
# 依赖：生产 PostgreSQL 容器 1Panel-postgresql-4LsS（用户 game，库 game_server）
# 说明：本脚本直连 DB 断言余额/库存/状态，避免依赖响应体形状；无 jq，JSON 解析用 sed。
# =============================================================================

BASE=${SMOKE_BASE:-http://127.0.0.1:3000}
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }

jstr() { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }
want_code() { echo "$2" | grep -qE "\"code\"[[:space:]]*:[[:space:]]*$3" && ok "$1" || bad "$1 (want code=$3)" "$2"; }

# 直连生产库取确定值（沿用 smoke-eco.sh 的 PSQL 模式）
CONTAINER=1Panel-postgresql-4LsS
PSQL() { docker exec -e PGCLIENTENCODING=UTF8 "$CONTAINER" psql -U game -d game_server -t -A -c "$1"; }
GOLD_OF() { PSQL "SELECT amount FROM player_currencies WHERE player_id=$1 AND currency_type='gold';"; }
INV_OF() { PSQL "SELECT quantity FROM inventory_items WHERE player_id=$1 AND item_template_id=$2 AND bind_status='unbound' AND deleted_at IS NULL;"; }
want_eq() { [ "$2" = "$3" ] && ok "$1 ($3)" || bad "$1 want=$3 got=${2:-none}" ""; }

ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
ADMIN_LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(jstr "$ADMIN_LOGIN" token)
if [ -n "$ADMIN_TOKEN" ]; then ok "admin login"; else bad "admin login" "$ADMIN_LOGIN"; exit 1; fi
AT="Authorization: Bearer $ADMIN_TOKEN"

TS=$(date +%s)
reg() {
  curl -s -X POST $BASE/api/client/v1/auth/register -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"Smoke123!\",\"nickname\":\"$1\",\"deviceId\":\"p07-dev\"}"
}
U1="p07_a_$TS"; U2="p07_b_$TS"
R=$(reg "$U1"); T1=$(jstr "$R" token); P1=$(jstr "$R" playerId)
[ -n "$T1" ] && ok "register A (player=$P1)" || bad "register A" "$R"
sleep 15
R=$(reg "$U2"); T2=$(jstr "$R" token); P2=$(jstr "$R" playerId)
[ -n "$T2" ] && ok "register B (player=$P2)" || bad "register B" "$R"
A1="Authorization: Bearer $T1"
A2="Authorization: Bearer $T2"
if [ -z "$P1" ] || [ -z "$P2" ]; then echo "FAIL: 玩家注册失败，中止"; exit 1; fi

# 造道具模板：真实路由是 POST /api/admin/v1/inventory/item-template（非 /template）
NEW_TPL() { # <name> <canTrade> -> echoes template id
  curl -s -X POST $BASE/api/admin/v1/inventory/item-template -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"itemType\":\"material\",\"rarity\":\"common\",\"maxStack\":99,\"sellPrice\":\"10\",\"canTrade\":$2,\"canDrop\":true,\"bindType\":\"none\"}" >/dev/null
  PSQL "SELECT id FROM item_templates WHERE name='$1' ORDER BY id DESC LIMIT 1;"
}
# 发道具：无 GM 发放接口，直插 inventory_items（列名同 InventoryItem 实体）
GRANT_ITEM() { # <playerId> <templateId> <qty> <bindStatus>
  PSQL "INSERT INTO inventory_items (player_id,item_template_id,quantity,slot_index,bind_status,created_at,updated_at) VALUES ($1,$2,$3,0,'$4',now(),now());" >/dev/null
}
# 发金币：真实路由是 PUT /api/admin/v1/player/:id/currency
GRANT_GOLD() { # <playerId> <amount>
  curl -s -X PUT $BASE/api/admin/v1/player/$1/currency -H "$AT" -H 'Content-Type: application/json' \
    -d "{\"currencyType\":\"gold\",\"amount\":$2,\"operation\":\"add\",\"reason\":\"smoke-p07\"}" >/dev/null
}

echo "==== P0-7 交易经济结算冒烟 ==== base=$BASE"
echo "== T0 准备 =="
TPL_ID=$(NEW_TPL "P07道具_$TS" true)
[ -n "$TPL_ID" ] && ok "create tradable template (id=$TPL_ID)" || bad "create tradable template" ""
TPL_NOTRADE=$(NEW_TPL "P07禁交易_$TS" false)
[ -n "$TPL_NOTRADE" ] && ok "create non-tradable template (id=$TPL_NOTRADE)" || bad "create non-tradable template" ""
TPL_BOUND=$(NEW_TPL "P07绑定_$TS" true)
[ -n "$TPL_BOUND" ] && ok "create bound-only template (id=$TPL_BOUND)" || bad "create bound-only template" ""
if [ -z "$TPL_ID" ] || [ -z "$TPL_NOTRADE" ] || [ -z "$TPL_BOUND" ]; then echo "FAIL: 模板创建失败，中止"; exit 1; fi

GRANT_ITEM $P1 $TPL_ID 10 unbound
GRANT_ITEM $P1 $TPL_NOTRADE 1 unbound
GRANT_ITEM $P1 $TPL_BOUND 1 bound
# 新号注册自带 initialGold（默认 1000），故基线以发钱前余额为准做增量断言
G1_SEED=$(GOLD_OF $P1); G2_SEED=$(GOLD_OF $P2)
GRANT_GOLD $P1 1000
GRANT_GOLD $P2 1000
want_eq "seller seeded 10 unbound" "$(INV_OF $P1 $TPL_ID)" 10
want_eq "seller seeded +1000 gold" "$(GOLD_OF $P1)" "$((G1_SEED + 1000))"
want_eq "buyer seeded +1000 gold" "$(GOLD_OF $P2)" "$((G2_SEED + 1000))"

echo "== T1 挂单托管库存 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":4,\"pricePerUnit\":\"100\",\"currencyType\":\"gold\"}")
ORDER_ID=$(jstr "$R" id)
[ -n "$ORDER_ID" ] && ok "create trade order (id=$ORDER_ID)" || bad "create trade order" "$R"
want_eq "escrow deducted seller to 6" "$(INV_OF $P1 $TPL_ID)" 6

echo "== T2 币种白名单与绑定判定 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"favor\"}")
want_code "social currency rejected" "$R" 70008
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"bound_diamond\"}")
want_code "bound diamond rejected" "$R" 70008
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_NOTRADE\",\"itemName\":\"P07禁交易\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"gold\"}")
want_code "non-tradable template rejected" "$R" 20005
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_BOUND\",\"itemName\":\"P07绑定\",\"quantity\":1,\"pricePerUnit\":\"100\",\"currencyType\":\"gold\"}")
want_code "bound-only stack rejected" "$R" 20003
want_eq "rejections left inventory untouched" "$(INV_OF $P1 $TPL_ID)" 6

echo "== T3 成交结算（买家付 400 / 卖家到手 380 / 买家收货 4）=="
G1_BEFORE=$(GOLD_OF $P1); G2_BEFORE=$(GOLD_OF $P2)
R=$(curl -s -X POST $BASE/api/client/v1/trade/order/$ORDER_ID/buy -H "$A2")
echo "$R" | grep -q '"status":"completed"' && ok "buy completed" || bad "buy completed" "$R"
want_eq "buyer paid 400" "$(GOLD_OF $P2)" "$((G2_BEFORE - 400))"
# 成交税 5% = 20，卖家无帮派则帮派分成为 0（差额归系统回收），卖家到手 380
want_eq "seller received 380" "$(GOLD_OF $P1)" "$((G1_BEFORE + 380))"
want_eq "buyer received 4 items" "$(INV_OF $P2 $TPL_ID)" 4

echo "== T4 二次购买被拒 =="
G2_AFTER=$(GOLD_OF $P2)
R=$(curl -s -X POST $BASE/api/client/v1/trade/order/$ORDER_ID/buy -H "$A2")
want_code "second buy rejected" "$R" 70003
want_eq "buyer not charged twice" "$(GOLD_OF $P2)" "$G2_AFTER"

echo "== T5 取消退货 =="
R=$(curl -s -X POST $BASE/api/client/v1/trade/order -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":2,\"pricePerUnit\":\"50\",\"currencyType\":\"gold\"}")
O2=$(jstr "$R" id)
want_eq "second order escrowed to 4" "$(INV_OF $P1 $TPL_ID)" 4
curl -s -X POST $BASE/api/client/v1/trade/order/$O2/cancel -H "$A1" >/dev/null
want_eq "cancel returned items to 6" "$(INV_OF $P1 $TPL_ID)" 6

echo "== T6 拍卖：上架托管+上架费 → 到期流拍退货 =="
GOLD_BEFORE=$(GOLD_OF $P1)
EXPIRED_AT=$(date -u -d '-60 seconds' +%Y-%m-%dT%H:%M:%SZ)
R=$(curl -s -X POST $BASE/api/client/v1/trade/auction -H "$A1" -H 'Content-Type: application/json' \
  -d "{\"itemTemplateId\":\"$TPL_ID\",\"itemName\":\"P07道具\",\"quantity\":2,\"startPrice\":\"100\",\"expireAt\":\"$EXPIRED_AT\"}")
AUC_ID=$(jstr "$R" id)
[ -n "$AUC_ID" ] && ok "list auction (id=$AUC_ID)" || bad "list auction" "$R"
want_eq "auction escrowed seller to 4" "$(INV_OF $P1 $TPL_ID)" 4
# 上架费 2% × (100×2) = 4 金币
want_eq "listing fee charged 4 gold" "$(GOLD_OF $P1)" "$((GOLD_BEFORE - 4))"
want_eq "auction row is listed" "$(PSQL "SELECT status FROM auction_items WHERE id=$AUC_ID;")" listed

echo "  等待定时任务结算到期拍卖（约 70s）..."
sleep 70
want_eq "auction auto expired" "$(PSQL "SELECT status FROM auction_items WHERE id=$AUC_ID;")" expired
want_eq "expired auction returned items to 6" "$(INV_OF $P1 $TPL_ID)" 6

echo "=============================="
echo "SMOKE P0-7 RESULT: PASS=$PASS FAIL=$FAIL"