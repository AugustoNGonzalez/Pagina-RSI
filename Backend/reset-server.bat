@echo off
schtasks /end /tn "Servidor RSI"
timeout /t 2 /nobreak > nul
schtasks /run /tn "Servidor RSI"
echo Servidor reiniciado.
timeout /t 3