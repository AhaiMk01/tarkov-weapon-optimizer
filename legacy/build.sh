#!/bin/bash
# Nuitka build script for Tarkov Weapon Optimizer
# Usage: ./build.sh [install]

set -e

echo "========================================"
echo "Building Tarkov Optimizer with Nuitka"
echo "========================================"

# Activate virtual environment if it exists
if [ -f ".venv/bin/activate" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
fi

# Install dependencies
install_deps() {
    echo "Installing dependencies..."
    pip install -r requirements.txt
    pip install nuitka
    echo "Done! Run './build.sh' to build the executable."
}

if [ "$1" == "install" ]; then
    install_deps
    exit 0
fi

echo "Building executable..."

python -m nuitka \
    --standalone \
    --onefile \
    --disable-console \
    --include-package=streamlit \
    --include-package=altair \
    --include-package=pandas \
    --include-package=plotly \
    --include-package=ortools \
    --include-data-dir=locales=locales \
    --include-data-file=tasks.json=tasks.json \
    --output-dir=dist \
    --python-flag=no_site \
    --python-flag=no_asserts \
    --python-flag=no_docstrings \
    app.py

echo ""
echo "========================================"
if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Executable: dist/app"
fi
echo "========================================"
