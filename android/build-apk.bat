@echo off
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot"
set "ANDROID_SDK_ROOT=C:\Users\agres\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "C:\Users\agres\Documents\Test\AirTerm\android"
echo Java version:
java -version
echo.
echo Stopping Gradle daemon (switch JDK)...
call "%~dp0gradlew.bat" --stop 2>nul
echo Building debug APK...
call "%~dp0gradlew.bat" assembleDebug
echo.
echo Exit code: %ERRORLEVEL%
if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo SUCCESS - APK found at: app\build\outputs\apk\debug\app-debug.apk
    dir "app\build\outputs\apk\debug\app-debug.apk"
) else (
    echo APK not found
)
