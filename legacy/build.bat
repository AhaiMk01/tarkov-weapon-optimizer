@echo off
REM Nuitka build script for Tarkov Weapon Optimizer
REM Usage: build.bat

echo ========================================
echo Building Tarkov Optimizer with Nuitka
echo ========================================

REM Activate virtual environment if it exists
if exist ".venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call .venv\Scripts\activate.bat
)

REM Install/build
if "%1"=="install" (
    echo Installing dependencies...
    pip install -r requirements.txt
    pip install nuitka
    echo Done! Run 'build.bat' to build the executable.
    goto :eof
)

echo Building executable...

nuitka ^
    --standalone ^
    --onefile ^
    --windows-disable-console ^
    --include-package=streamlit ^
    --include-package=altair ^
    --include-package=pandas ^
    --include-package=plotly ^
    --include-package=ortools ^
    --include-data-dir=locales=locales ^
    --include-data-file=tasks.json=tasks.json ^
    --output-dir=dist ^
    --python-flag=no_site ^
    --python-flag=no_asserts ^
    --python-flag=no_docstrings ^
    app.py

if %errorlevel% equ 0 (
    echo ========================================
    echo Build successful!
    echo Executable: dist\app.exe
    echo ========================================
) else (
    echo Build failed with error %errorlevel%
)

pause
