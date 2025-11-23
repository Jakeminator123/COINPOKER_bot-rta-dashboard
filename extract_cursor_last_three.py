import os
import json
import sqlite3
from pathlib import Path

def find_latest_state_db() -> Path | None:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        print("APPDATA saknas")
        return None

    ws_root = Path(appdata) / "Cursor" / "User" / "workspaceStorage"
    candidates = []
    for sub in ws_root.iterdir():
        db_path = sub / "state.vscdb"
        if db_path.exists():
            candidates.append(db_path)

    if not candidates:
        print("Ingen state.vscdb hittad")
        return None

    return max(candidates, key=lambda p: p.stat().st_mtime)

def load_generations(db_path: Path):
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    cur = conn.cursor()
    cur.execute("SELECT value FROM ItemTable WHERE key = 'aiService.generations'")
    row = cur.fetchone()
    conn.close()
    if not row:
        print("Ingen aiService.generations hittad")
        return []
    return json.loads(row[0])

def main():
    db_path = find_latest_state_db()
    if not db_path:
        return

    gens = load_generations(db_path)
    if not gens:
        return

    # Sortera på tid (om det inte redan är det)
    gens_sorted = sorted(gens, key=lambda g: g["unixMs"])
    last_three = gens_sorted[-3:]

    for i, g in enumerate(last_three, start=1):
        print("=" * 80)
        print(f"Generation {i}")
        print(f"type: {g['type']}")
        print(f"unixMs: {g['unixMs']}")
        print()
        print(g["textDescription"])
        print()

if __name__ == "__main__":
    main()
