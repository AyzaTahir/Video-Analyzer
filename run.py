import os
import sys
import uvicorn

if __name__ == "__main__":
    # Ensure current directory is in python search path
    current_dir = os.path.dirname(os.path.abspath(__file__))
    web_dir = os.path.join(current_dir, "apps", "web")
    sys.path.insert(0, web_dir)

    print("------------------------------------------------------------------")
    print("      Starting Video Analyzer Local Service — Attio Theme Enabled  ")
    print("------------------------------------------------------------------")
    print(f"Web Interface:  http://127.0.0.1:8000")
    print(f"API endpoints:  http://127.0.0.1:8000/docs")
    print("Press Ctrl+C to stop the local web server.")
    print("------------------------------------------------------------------")

    # Run the uvicorn development server
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
