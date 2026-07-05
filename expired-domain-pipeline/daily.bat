@echo off
setlocal
cd /d "%~dp0"

REM Timestamp cho log (yyyyMMdd_HHmmss)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TS=%%i
if not exist data\logs mkdir data\logs
set LOG=data\logs\daily_%TS%.log

call .venv\Scripts\activate.bat

echo [%date% %time%] START daily .org pipeline >> "%LOG%" 2>&1

REM 1) Chup snapshot .org hom nay
python -m pipeline drops pull --tld org >> "%LOG%" 2>&1
if errorlevel 1 ( echo *** LOI pull zone *** >> "%LOG%" & goto :rdap )

REM 2) Diff voi hom truoc -> domain vua het han
python -m pipeline drops diff --tld org >> "%LOG%" 2>&1
if errorlevel 1 (
  echo Chua du 2 snapshot de diff - hom nay chi chup snapshot. >> "%LOG%"
  goto :rdap
)

REM 3) Loc -> candidates (KHONG chay Wayback CDX free nua — "Check Wayback" = Apify tren trang Domain Drop)
python -m pipeline filter run >> "%LOG%" 2>&1

REM 4) Cham diem  5) Day len Supabase (Domain Drop), bo qua domain da co
python -m pipeline score run --top 2000 >> "%LOG%" 2>&1
python -m pipeline push run >> "%LOG%" 2>&1

REM 6) RDAP: refresh trang thai vong doi (redemption/pending-delete/available) cho
REM MOI domain 'new' -> banner "CAN MUA NGAY" tu bat khi vao pending-delete. Chay
REM ca khi hom nay khong co drop moi (cac goto :rdap o tren nhay thang xuong day).
:rdap
python -m pipeline rdap run >> "%LOG%" 2>&1

REM 7) Gia mua Gname (register + backorder) -> gname_pricing. CAN IP may nay da whitelist tren Gname.
python -m pipeline gname price >> "%LOG%" 2>&1

echo [%date% %time%] DONE. Mo trang Domain Drop de xem candidate moi. >> "%LOG%" 2>&1

:end
endlocal
