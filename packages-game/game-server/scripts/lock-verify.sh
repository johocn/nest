#!/bin/bash
BASE=http://127.0.0.1:3000
AP=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
AT=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$AP\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$AT" ] || { echo "FAIL admin login"; exit 1; }

PG() { docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -tAq "$@"; }

CASE_ID=$(PG -c "INSERT INTO risk_cases (case_type, risk_score, status, from_id, to_id, detail_json, wf_ids) VALUES ('wash', 90, 'open', '96', '96', '{\"smoke\":true}', '[]') RETURNING id;" | grep -m1 '^[0-9]\+$')
echo "inserted case id=$CASE_ID"
[ -n "$CASE_ID" ] || { echo "FAIL insert case"; exit 1; }

R=$(curl -s -X POST $BASE/api/admin/v1/risk/cases/$CASE_ID/lock -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"level":"ban","reason":"deploy-smoke lock 闭环"}')
echo "lock_body=$R"
echo "$R" | grep -q '"result"\|"applied"\|"caseId"\|"code":90000\|"code":90001' && echo "PASS: risk lock" || echo "FAIL: risk lock"

ST=$(PG -c "SELECT status FROM risk_cases WHERE id=$CASE_ID;")
echo "case status=$ST"
[ "$ST" = "frozen" ] && echo "PASS: case frozen" || echo "FAIL: case not frozen"

PT=$(PG -c "SELECT level FROM account_penalties WHERE player_id='96' ORDER BY id DESC LIMIT 1;")
echo "penalty=$PT"
[ "$PT" = "ban" ] && echo "PASS: penalty ban applied" || echo "FAIL: no ban penalty"

# 清理合成数据（风控线索 + 惩罚），只删 smoke 标记
PG -c "DELETE FROM risk_cases WHERE id=$CASE_ID;" >/dev/null && echo "cleaned synthetic case"
PG -c "DELETE FROM account_penalties WHERE player_id='96' AND reason='deploy-smoke lock 闭环';" >/dev/null && echo "cleaned synthetic penalty"