#!/bin/bash
# Запуск Вокселии на Mac
cd "$(dirname "$0")"
echo "Запуск Вокселии на http://localhost:8123 ..."
open "http://localhost:8123"
python3 -m http.server 8123
