@echo off
echo Adding firewall rule for AgentRune (port 3456)...
netsh advfirewall firewall add rule name="AgentRune" dir=in action=allow protocol=TCP localport=3456
if %ERRORLEVEL%==0 (
    echo.
    echo OK! Firewall rule added successfully.
) else (
    echo.
    echo FAILED - Please right-click this file and select "Run as administrator"
)
echo.
pause
