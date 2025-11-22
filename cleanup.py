#!/usr/bin/env python3
"""
Automatic code cleanup script using Ruff.
Run this manually to clean up all files at once.
"""

import subprocess
import sys
from pathlib import Path


def check_ruff_installed() -> bool:
    """Check if Ruff is installed."""
    try:
        subprocess.run(["ruff", "--version"], check=True, capture_output=True, text=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def main():
    """Run Ruff auto-fix and format on all Python files."""
    print("=" * 60)
    print("  AUTOMATIC CODE CLEANUP")
    print("=" * 60)
    print()

    # Check if Ruff is installed
    if not check_ruff_installed():
        print("ERROR: Ruff is not installed.")
        print("Install with: pip install ruff")
        print()
        print("Or install via pre-commit:")
        print("  pip install pre-commit")
        print("  pre-commit install")
        sys.exit(1)

    print("[1/2] Running Ruff lint with auto-fix...")
    result = subprocess.run(["ruff", "check", "--fix", "."], cwd=Path(__file__).parent)

    if result.returncode != 0:
        print("⚠️  Some issues were fixed, but some remain (check output above)")
    else:
        print("✅ All linting issues fixed!")

    print()
    print("[2/2] Running Ruff format...")
    result = subprocess.run(["ruff", "format", "."], cwd=Path(__file__).parent)

    if result.returncode == 0:
        print("✅ All files formatted!")
    else:
        print("⚠️  Formatting completed with warnings")

    print()
    print("=" * 60)
    print("  CLEANUP COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
