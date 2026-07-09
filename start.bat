@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск Вокселии на http://localhost:8123 ...
start "" http://localhost:8123
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8123
) else (
  echo Python не найден, пробую npx serve...
  npx --yes serve -l 8123 .
)
