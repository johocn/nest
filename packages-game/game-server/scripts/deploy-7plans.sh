#!/bin/bash
set -e
APP=/opt/game-server
TS=$(date +%Y%m%d_%H%M%S)
echo "== backup =="
cp -r "$APP/dist" "$APP/dist_prev_$TS"
echo "  backup -> dist_prev_$TS"
echo "== unpack new dist =="
rm -rf "$APP/dist"
mkdir -p "$APP/dist"
tar -xzf /tmp/dist-7plans-final.tar.gz -C "$APP/dist"
echo "  unpacked $(find "$APP/dist" -type f | wc -l) files"
echo "== restart =="
systemctl restart game-server
sleep 6
echo "== status =="
systemctl is-active game-server
echo "== recent log =="
journalctl -u game-server --since "-40 sec" --no-pager | tail -20