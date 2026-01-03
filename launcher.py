"""
Launcher for PyInstaller bundled Streamlit app.
This file is the entry point - it does NOT import streamlit or app.py directly.
"""
import sys
import os

if __name__ == "__main__":
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        import webbrowser
        import threading

        # app.py is bundled as data file in _MEIPASS
        script_path = os.path.join(sys._MEIPASS, "app.py")

        # Open browser after delay
        def open_browser():
            import time
            time.sleep(2)
            webbrowser.open("http://localhost:8501")
        threading.Thread(target=open_browser, daemon=True).start()

        # Import streamlit CLI here (not at top level)
        from streamlit.web import cli as stcli

        sys.argv = [
            "streamlit",
            "run",
            script_path,
            "--server.headless=true",
            "--browser.gatherUsageStats=false",
            "--global.developmentMode=false",
        ]
        stcli.main()
    else:
        # Normal development - just run streamlit
        from streamlit.web import cli as stcli
        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        sys.argv = ["streamlit", "run", app_path, "--server.headless=false"]
        sys.exit(stcli.main())
