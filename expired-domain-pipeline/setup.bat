@echo off
setlocal
cd /d "%~dp0"
echo === Expired Domain Pipeline - cai dat (Windows) ===

REM Tao virtualenv (uu tien launcher py, fallback python)
where py >nul 2>nul
if %errorlevel%==0 ( py -3 -m venv .venv ) else ( python -m venv .venv )

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo ============================================================
echo Xong! Cach dung:
echo   1) Mo cmd trong thu muc nay
echo   2) .venv\Scripts\activate
echo   3) python -m pipeline --help
echo      python -m pipeline wpl build --dump enwiki-externallinks.sql.gz
echo ============================================================
endlocal
pause
