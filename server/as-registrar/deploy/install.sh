#!/usr/bin/env bash
# 在 Tuwunel 所在服务器上一键部署 as-registrar（systemd + 零依赖 Node 22+）
#
# 用法（在服务器上，仓库已 clone / 已上传）：
#   cd <repo>/server/as-registrar/deploy
#   sudo bash install.sh
#
# 首次运行会生成 /etc/as-registrar/env 模板并退出；填好真实值后**再跑一次**即安装并启动。
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # .../server/as-registrar
DEST=/opt/as-registrar
ENV_SRC="$SRC_DIR/deploy/as-registrar.env.example"
ENV_DST=/etc/as-registrar/env
SERVICE_SRC="$SRC_DIR/deploy/as-registrar.service"
SERVICE_DST=/etc/systemd/system/as-registrar.service

# 1. Node 22+ 检查
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 node。请先安装 Node.js 22+："
  echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "   sudo apt-get install -y nodejs"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ 需要 Node.js 22+（当前 $(node -v)）"; exit 1
fi
echo "✅ Node $(node -v)"

# 2. 复制代码（as-registrar 独立、零依赖，只拷这一层）
mkdir -p "$DEST"
cp -r "$SRC_DIR"/* "$DEST"/
rm -rf "$DEST/deploy"   # deploy 脚本自身不必进运行目录

# 3. 环境变量：首次只生成模板
if [ ! -f "$ENV_DST" ]; then
  mkdir -p "$(dirname "$ENV_DST")"
  cp "$ENV_SRC" "$ENV_DST"
  echo
  echo "✅ 已生成 $ENV_DST"
  echo "   请编辑填入真实值（ADMIN_ACCESS_TOKEN / ADMIN_ROOM_ID / AS_REGISTRAR_TOKEN 等）："
  echo "   sudo nano $ENV_DST"
  echo "   填好后**再跑一次本脚本**（sudo bash install.sh）即安装并启动。"
  exit 0
fi

# 4. 校验关键字段非空
missing=0
for k in HOMESERVER_URL ADMIN_ACCESS_TOKEN ADMIN_ROOM_ID AS_REGISTRAR_TOKEN; do
  if ! grep -Eq "^${k}=[^[:space:]]+" "$ENV_DST"; then
    echo "❌ $ENV_DST 里 $k 未填写" ; missing=1
  fi
done
[ "$missing" -ne 0 ] && exit 1

# 5. 安装 systemd 单元并启动
cp "$SERVICE_SRC" "$SERVICE_DST"
systemctl daemon-reload
systemctl enable --now as-registrar.service
sleep 1
echo "---- systemctl status ----"
systemctl --no-pager --full status as-registrar.service || true
echo "---- healthz ----"
curl -sS "http://127.0.0.1:8797/healthz" && echo || echo "(healthz 失败：查 journalctl -u as-registrar)"
echo
echo "✅ 部署完成。Jarvis 客户端 IM Tab 里填："
echo "   Registrar URL   = https://<反代域名>/  或  http://<本机外网IP>:8797"
echo "   Registrar Token = /etc/as-registrar/env 里 AS_REGISTRAR_TOKEN 的值"
