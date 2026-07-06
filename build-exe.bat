@echo off
rem Bygger LT-Fabrik.exe (selvstaendigt program, kraever ikke Node hos brugeren).
rem Kraever Node 22+ og internet foerste gang (henter postject via npx).
cd /d "%~dp0"

echo [1/3] Bygger SEA-blob...
node --experimental-sea-config sea-config.json || goto :fejl

echo [2/3] Kopierer node.exe...
for /f "delims=" %%i in ('where node') do set NODEEXE=%%i
copy /y "%NODEEXE%" "LT-Fabrik.exe" >nul || goto :fejl

echo [3/3] Injicerer app'en i exe-filen...
call npx -y postject "LT-Fabrik.exe" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 || goto :fejl

del sea-prep.blob
echo.
echo Faerdig: LT-Fabrik.exe
echo Laeg exe-filen i en mappe sammen med dine slide-mapper og dobbeltklik.
pause
exit /b 0

:fejl
echo BYGNING FEJLEDE.
pause
exit /b 1
