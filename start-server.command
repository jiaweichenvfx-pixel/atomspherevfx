#!/bin/bash
cd "$(dirname "$0")"
echo "AtmosphereFX 开发服务器启动中..."
echo "请在 Chrome 中打开: http://localhost:8080"
echo "按 Ctrl+C 停止服务器"
python3 -m http.server 8080
