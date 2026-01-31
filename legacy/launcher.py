"""
Launcher for PyInstaller bundled Streamlit app.

This file is the entry point for the bundled executable.
It does NOT import streamlit or app.py at the top level to avoid
Streamlit runtime initialization conflicts.
"""
import sys
import os

STREAMLIT_PORT = 8501
STREAMLIT_URL = f"http://localhost:{STREAMLIT_PORT}"


def open_browser_with_retry(url, max_retries=3, delay=2):
    """Open browser with retry logic and fallback message."""
    import time
    import webbrowser

    time.sleep(delay)

    for attempt in range(max_retries):
        try:
            if webbrowser.open(url):
                return True
        except Exception:
            pass
        time.sleep(1)

    # Fallback: print URL to console
    print(f"\nCould not open browser automatically.")
    print(f"Please open this URL manually: {url}\n")
    return False


if __name__ == "__main__":
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        import threading

        script_path = os.path.join(sys._MEIPASS, "app.py")

        if not os.path.exists(script_path):
            print(f"Error: Could not find app.py at {script_path}")
            sys.exit(1)

        # Open browser after delay (in background thread)
        threading.Thread(
            target=open_browser_with_retry,
            args=(STREAMLIT_URL,),
            daemon=True
        ).start()

        from streamlit.web import cli as stcli

        sys.argv = [
            "streamlit",
            "run",
            script_path,
            "--server.headless=true",
            f"--server.port={STREAMLIT_PORT}",
            "--browser.gatherUsageStats=false",
            "--global.developmentMode=false",
        ]
        stcli.main()
    else:
        # Normal development mode
        from streamlit.web import cli as stcli

        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        sys.argv = ["streamlit", "run", app_path, "--server.headless=false"]
        sys.exit(stcli.main())
