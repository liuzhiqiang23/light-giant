@echo off
title 光之巨人 · 方块世界 - 本地服务器
cd /d %~dp0
echo ================================================
echo   光之巨人 · 方块世界
echo   浏览器将自动打开游戏页面
echo   关闭本窗口 = 退出游戏服务
echo ================================================
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8930/"
python -m http.server 8930
