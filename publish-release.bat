@echo off
rem Udgiver ny version: ret "version" i package.json foerst, og koer saa denne.
cd /d "%~dp0"
node publish-release.js
pause
