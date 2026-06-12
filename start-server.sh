#!/bin/bash
cd "$(dirname "$0")"
echo "==================================="
echo " AtmosphereFX 开发服务器"
echo "==================================="
echo "打开后请在 Chrome 访问: http://localhost:8080"
echo "按 Ctrl+C 停止服务器"
echo "==================================="
echo ""
python3 -m http.server 8080
