@echo off
REM Clean up PyInstaller build artifacts
echo Cleaning build artifacts...

if exist "build" (
    echo Removing build\
    rmdir /s /q build
)

if exist "dist" (
    echo Removing dist\
    rmdir /s /q dist
)

if exist "__pycache__" (
    echo Removing __pycache__\
    rmdir /s /q __pycache__
)

REM Clean .pyc files
for /r %%i in (*.pyc) do (
    echo Removing %%i
    del /q "%%i"
)

REM Clean .pyo files
for /r %%i in (*.pyo) do (
    echo Removing %%i
    del /q "%%i"
)

echo Done!
