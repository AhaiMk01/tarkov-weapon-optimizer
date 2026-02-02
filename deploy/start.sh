#!/bin/bash
set -e
cd /root/tarkov-weapon-optimizer
systemctl start tarkov-optimizer
echo "服务已启动"
