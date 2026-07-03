@echo off
setlocal
cd /d "%~dp0"
call .venv\Scripts\activate.bat

echo === [%date% %time%] Daily drop pipeline (.org) ===

REM 1) Chup snapshot .org hom nay
python -m pipeline drops pull --tld org
if errorlevel 1 ( echo *** LOI pull zone *** & goto :end )

REM 2) Diff voi hom truoc -> domain vua het han
python -m pipeline drops diff --tld org
if errorlevel 1 (
  echo Chua du 2 snapshot de diff - hom nay chi chup snapshot. Chay lai daily.bat NGAY MAI.
  goto :end
)

REM 3) Loc drops -> candidates (dung WPL da build; ccrank tuy chon)
python -m pipeline filter run

REM 4) Wayback chi cho candidate (re), roi loc lai de co tuoi domain
python -m pipeline wayback check --from candidates --rps 5
python -m pipeline filter run

REM 5) Cham diem + xuat final_<date>.csv
python -m pipeline score run --top 2000

REM 6) Day thang len Supabase (Domain Drop), bo qua domain da co trong DB
python -m pipeline push run

echo.
echo === XONG. Mo trang Domain Drop tren web -> candidate moi da co san (khong can Import tay) ===

:end
endlocal
pause
