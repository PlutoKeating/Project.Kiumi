#!/usr/bin/env bash
# 启动或更新 kiumi-data（可重复运行）：首次生成 .env 与服务密钥，构建并启动容器，等待健康检查。
#   ./start.sh          启动 / 更新
#   ./start.sh --key    打印服务密钥（配置 Worker Secret 时用）
set -euo pipefail
cd "$(dirname "$0")"
umask 077
if [[ ! -f .env ]]; then cp .env.example .env; chmod 600 .env; fi
if ! grep -q '^KIUMI_DATA_KEY=.\{32,\}' .env; then
  key=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)
  sed -i "s/^KIUMI_DATA_KEY=.*/KIUMI_DATA_KEY=$key/" .env
  echo "● 已生成服务密钥（./start.sh --key 查看）"
fi
if [[ ${1:-} == --key ]]; then sed -n 's/^KIUMI_DATA_KEY=//p' .env; exit 0; fi
mkdir -p data
docker compose up -d --build
port=$(sed -n 's/^KIUMI_DATA_LOCAL_PORT=//p' .env); port=${port:-8792}
key=$(sed -n 's/^KIUMI_DATA_KEY=//p' .env)
for i in $(seq 1 30); do
  if curl -fsS -m 3 -H "x-data-key: $key" "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
    echo "✓ kiumi-data 在 127.0.0.1:$port 运行"; exit 0
  fi
  sleep 2
done
echo "✗ 60 秒内没有就绪：docker compose logs data" >&2; exit 1
