#!/usr/bin/env python3
"""
Litet script som letar efter vanliga MITM-/inspektions-CA:er
i Windows certifikat-store (Root + CA, user + machine).
"""

import subprocess

# Nyckelord som ofta förekommer i namn på MITM / SSL-inspektion / proxy-CA:er.
SUSPICIOUS_KEYWORDS = [
    "mitmproxy",
    "burp",
    "portswigger",
    "fiddler",
    "charles",
    "zscaler",
    "blue coat",
    "fortinet",
    "fortigate",
    "checkpoint",
    "palo alto",
    "netskope",
    "ssl inspection",
    "tls inspection",
    "deep inspection",
]

# Vi tittar i Root och CA-store
STORES = ["root", "ca"]

# Både user- och machine-context
# - utan flagg = LocalMachine
# - -user = CurrentUser
CONTEXTS = {
    "user": ["-user"],
    "machine": [],
}


def run_certutil(store: str, context_name: str) -> str:
    """Kör certutil och returnerar rå text-output."""
    args = ["certutil", "-store"] + CONTEXTS[context_name] + [store]
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            errors="ignore",
        )
    except FileNotFoundError:
        print("certutil.exe hittades inte – scriptet måste köras på Windows.")
        return ""

    if result.returncode != 0:
        # T.ex. kan vissa stores vara tomma i en viss context
        return ""

    return result.stdout or ""


def scan_text_for_suspicious(text: str):
    """Splitta upp certutil-output i block och leta efter misstänkta nyckelord."""
    findings = []
    blocks = text.split("========")  # certutil separerar cert med ========
    for block in blocks:
        lower_block = block.lower()
        if not any(keyword in lower_block for keyword in SUSPICIOUS_KEYWORDS):
            continue

        lines = [l.strip() for l in block.splitlines()]

        subject = next((l for l in lines if "Subject" in l), "(Subject okänt)")
        issuer = next((l for l in lines if "Issuer" in l), "(Issuer okänt)")
        sha1 = next((l for l in lines if "Cert Hash" in l), "(Cert Hash okänd)")

        findings.append(
            {
                "subject": subject,
                "issuer": issuer,
                "hash": sha1,
                "raw": block.strip(),
            }
        )

    return findings


def main():
    all_findings = []

    for store in STORES:
        for context_name in CONTEXTS:
            output = run_certutil(store, context_name)
            if not output:
                continue

            findings = scan_text_for_suspicious(output)
            for f in findings:
                f["store"] = store
                f["context"] = context_name
            all_findings.extend(findings)

    if not all_findings:
        print("Inga tydligt misstänkta MITM-/proxy-CA:er hittades i Root/CA-store.")
        return

    print("Hittade potentiellt MITM/proxy-relaterade certifikat:\n")
    for f in all_findings:
        print(f"[{f['context']}/{f['store']}]")
        print("  " + f["subject"])
        print("  " + f["issuer"])
        print("  " + f["hash"])
        print()


if __name__ == "__main__":
    main()
