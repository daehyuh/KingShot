from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path


def read_clipboard() -> str | None:
    if sys.platform == "darwin":
        command = ["pbpaste"]
    elif sys.platform.startswith("win"):
        command = ["powershell", "-NoProfile", "-Command", "Get-Clipboard"]
    else:
        if shutil.which("wl-paste"):
            command = ["wl-paste", "--no-newline"]
        elif shutil.which("xclip"):
            command = ["xclip", "-selection", "clipboard", "-o"]
        elif shutil.which("xsel"):
            command = ["xsel", "--clipboard", "--output"]
        else:
            return None

    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return None
    return result.stdout


def normalize_clipboard_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    parts = [part.strip() for part in normalized.split("\n")]
    single_line = " ".join(part for part in parts if part)
    return single_line.strip()


def append_line(output_path: Path, line: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as file:
        file.write(f"{line}\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Watch clipboard text and append each new copy to output.txt"
    )
    parser.add_argument(
        "--output",
        default="output.txt",
        help="Output file path. Default: output.txt",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.4,
        help="Clipboard polling interval in seconds. Default: 0.4",
    )
    args = parser.parse_args()

    output_path = Path(args.output).expanduser().resolve()
    last_seen: str | None = None

    print(f"Watching clipboard. Saving to {output_path}")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            raw_text = read_clipboard()
            if raw_text is None:
                time.sleep(args.interval)
                continue

            line = normalize_clipboard_text(raw_text)
            if line and line != last_seen:
                append_line(output_path, line)
                last_seen = line
                print(f"Saved: {line}")

            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
