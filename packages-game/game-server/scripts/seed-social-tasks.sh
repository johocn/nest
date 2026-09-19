#!/bin/bash
# E4 社交/生态任务种子脚本（幂等）— 服务器执行
# 运行方式（服务器）：bash /tmp/seed-social-tasks.sh
# 行为：将 seed-social-tasks.sql 同步进容器 /tmp 后以 psql -f 执行；
#       SQL 按 name NOT EXISTS 幂等，重复执行不产生重复行。
# psql 调用模式参考 scripts/smoke-stage3.sh（docker exec 1Panel-postgresql-4LsS psql -U game -d game_server）
set -e

CONTAINER=1Panel-postgresql-4LsS
DB_USER=game
DB_NAME=game_server
REMOTE_SQL=/tmp/seed-social-tasks.sql

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
LOCAL_SQL="$SCRIPT_DIR/seed-social-tasks.sql"

echo "[seed-social-tasks] syncing $LOCAL_SQL -> $CONTAINER:$REMOTE_SQL"
docker cp "$LOCAL_SQL" "$CONTAINER:$REMOTE_SQL"

echo "[seed-social-tasks] executing $REMOTE_SQL (idempotent)"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$REMOTE_SQL"

echo "[seed-social-tasks] done. social_seed_count 应为 12（重复执行结果不变）"
