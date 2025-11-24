"""Embed runtime config into core/runtime_config_embedded.py.

Reads config.txt and writes a generated module so exe builds can
bootstrap without shipping a separate config file.
"""

from __future__ import annotations

import textwrap
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_CONFIG = REPO_ROOT / "config.txt"
TARGET_MODULE = REPO_ROOT / "core" / "runtime_config_embedded.py"


def main() -> None:
    if not SOURCE_CONFIG.exists():
        raise FileNotFoundError(f"config.txt not found at {SOURCE_CONFIG}")

    config_text = SOURCE_CONFIG.read_text(encoding="utf-8").strip("\n") + "\n"

    module_text = textwrap.dedent(
        f'''\
        """
        Auto-generated runtime config snapshot.
        DO NOT EDIT MANUALLY. Use tools/embed_runtime_config.py.
        """

        CONFIG_TEXT = {config_text!r}
        '''
    )

    TARGET_MODULE.write_text(module_text, encoding="utf-8")
    print(f"[embed_config] Embedded config -> {TARGET_MODULE.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()

