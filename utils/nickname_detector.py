# nickname_detector.py
"""
Nickname detection using OCR on CoinPoker lobby window.
Integrated directly into ProcessScanner - no separate process needed.
"""

import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytesseract
from PIL import Image, ImageEnhance, ImageGrab

try:
    import win32gui
    import win32process
    import win32ui
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

# Tesseract configuration
TESSERACT_EXE = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
TESSDATA_DIR = r"C:\Program Files\Tesseract-OCR\tessdata"

NICKNAME_CONFIG_FILENAME = "nickname_region_config.json"


def ensure_tesseract() -> bool:
    """Check if Tesseract OCR is available."""
    if Path(TESSERACT_EXE).exists():
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_EXE
        if Path(TESSDATA_DIR).exists():
            os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR

    try:
        _ = pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def load_nickname_config() -> dict | None:
    """Load nickname region/color config from JSON file."""
    try:
        project_root = Path(__file__).parent.parent
        config_path = project_root / NICKNAME_CONFIG_FILENAME

        if not config_path.exists():
            return None

        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)

        return config
    except Exception:
        return None


def grab_window(hwnd: int) -> Image.Image | None:
    """Capture window screenshot."""
    if not WIN32_AVAILABLE:
        return None

    try:
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width, height = right - left, bottom - top

        hwndDC = win32gui.GetWindowDC(hwnd)
        mfcDC = win32ui.CreateDCFromHandle(hwndDC)
        saveDC = mfcDC.CreateCompatibleDC()

        saveBitMap = win32ui.CreateBitmap()
        saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
        saveDC.SelectObject(saveBitMap)

        res = win32gui.PrintWindow(hwnd, saveDC.GetSafeHdc(), 0)
        bmpinfo = saveBitMap.GetInfo()
        bmpstr = saveBitMap.GetBitmapBits(True)

        img = Image.frombuffer(
            "RGB",
            (bmpinfo["bmWidth"], bmpinfo["bmHeight"]),
            bmpstr,
            "raw",
            "BGRX",
            0,
            1,
        )

        win32gui.DeleteObject(saveBitMap.GetHandle())
        saveDC.DeleteDC()
        mfcDC.DeleteDC()
        win32gui.ReleaseDC(hwnd, hwndDC)

        if res == 1:
            return img
    except Exception:
        pass

    # Fallback: regular screenshot
    try:
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        return ImageGrab.grab(bbox=(left, top, right, bottom))
    except Exception:
        return None


def crop_username_region(image: Image.Image, use_auto_config: bool = True) -> Image.Image:
    """Crop to upper-right region where username typically appears."""
    width, height = image.size

    # Try to load auto-detected config
    if use_auto_config:
        config = load_nickname_config()
        if config:
            try:
                left = int(width * config.get("region_left_pct", 0.65))
                top = int(height * config.get("region_top_pct", 0.0))
                right = int(width * config.get("region_right_pct", 1.0))
                bottom = int(height * config.get("region_bottom_pct", 0.15))

                if (
                    left >= 0
                    and top >= 0
                    and right <= width
                    and bottom <= height
                    and right > left
                    and bottom > top
                ):
                    return image.crop((left, top, right, bottom))
            except Exception:
                pass

    # Default region: upper-right corner
    left = int(width * 0.65)
    top = 0
    right = width
    bottom = int(height * 0.15)

    if left < 0:
        left = 0
    if top < 0:
        top = 0
    if right > width:
        right = width
    if bottom > height:
        bottom = height
    if right <= left or bottom <= top:
        return image

    return image.crop((left, top, right, bottom))


def filter_red_text(image: Image.Image, tolerance: int = 50, use_auto_config: bool = True) -> Image.Image:
    """Filter image to keep only red/reddish pixels."""
    try:
        # Try to load auto-detected config
        if use_auto_config:
            config = load_nickname_config()
            if config and config.get("is_red_text", False):
                color_rgb = config.get("text_color_rgb", [200, 50, 50])
                auto_tolerance = config.get("color_tolerance", 30)
                return filter_by_color(image, color_rgb, auto_tolerance)
            elif config and not config.get("is_red_text", False):
                return image

        # Default: red text filtering
        img_array = np.array(image)
        r = img_array[:, :, 0]
        g = img_array[:, :, 1]
        b = img_array[:, :, 2]

        red_mask = (
            (r > 120)
            & (r > g)
            & (r > b)
            & ((r > g + tolerance) | (r > b + tolerance))
        )

        filtered = np.zeros_like(img_array)
        filtered[red_mask] = [255, 255, 255]
        filtered[~red_mask] = [0, 0, 0]

        filtered_img = Image.fromarray(filtered.astype(np.uint8))
        enhancer = ImageEnhance.Contrast(filtered_img)
        filtered_img = enhancer.enhance(2.0)

        return filtered_img
    except Exception:
        return image


def filter_by_color(image: Image.Image, target_rgb: list, tolerance: int = 30) -> Image.Image:
    """Filter image to keep only pixels matching target color within tolerance."""
    try:
        img_array = np.array(image)
        r = img_array[:, :, 0]
        g = img_array[:, :, 1]
        b = img_array[:, :, 2]

        target_r, target_g, target_b = target_rgb

        color_mask = (
            (np.abs(r - target_r) <= tolerance)
            & (np.abs(g - target_g) <= tolerance)
            & (np.abs(b - target_b) <= tolerance)
        )

        filtered = np.zeros_like(img_array)
        filtered[color_mask] = [255, 255, 255]
        filtered[~color_mask] = [0, 0, 0]

        filtered_img = Image.fromarray(filtered.astype(np.uint8))
        enhancer = ImageEnhance.Contrast(filtered_img)
        filtered_img = enhancer.enhance(2.0)

        return filtered_img
    except Exception:
        return image


def ocr_text(
    image: Image.Image,
    use_region: bool = True,
    use_color_filter: bool = True,
    use_auto_config: bool = True,
) -> str:
    """OCR text from image with optional region cropping and color filtering."""
    try:
        if use_region:
            image = crop_username_region(image, use_auto_config=use_auto_config)

        if use_color_filter:
            image = filter_red_text(image, tolerance=30, use_auto_config=use_auto_config)

        try:
            return pytesseract.image_to_string(image, lang="eng+osd")
        except Exception:
            return pytesseract.image_to_string(image)
    except Exception:
        try:
            return pytesseract.image_to_string(image, lang="eng+osd")
        except Exception:
            return pytesseract.image_to_string(image)


def extract_player_name_from_lobby(hwnd: int, ocr_text: str) -> tuple[str | None, float]:
    """Extract nickname from CoinPoker lobby window using OCR text."""
    import re

    excluded_words = {
        "coinpoker", "lobby", "cash", "games", "tournaments", "sit", "go",
        "wallet", "profile", "settings", "help", "login", "register",
        "hold'em", "omaha", "poker", "table", "seat", "blinds", "ante",
        "chips", "balance", "deposit", "withdraw", "history", "leaderboard",
        "learnedconfig", "learned", "config", "region", "nickname",
    }

    username_patterns = [
        r"^[A-Za-z][A-Za-z0-9_\.-]{2,20}$",
        r"[A-Za-z][A-Za-z0-9_\.-]{2,20}",
    ]

    lines = [ln.strip() for ln in ocr_text.splitlines() if ln.strip()]
    candidates = []

    for line in lines:
        words = re.split(r"[\s\-_\|/]+", line)
        for word in words:
            word = word.strip()
            if not word or len(word) < 3:
                continue

            if word.lower() in excluded_words:
                continue

            if re.match(r"^[\d₮$€£¥]+$", word):
                continue

            if re.search(r"[\\\'\"<>{}[\]|`~]", word):
                continue

            for pattern in username_patterns:
                if re.match(pattern, word) and not word.isdigit():
                    confidence = 0.5
                    line_lower = line.lower()

                    currency_pattern = re.compile(r"[¥$€£₮]|chp|usd|eur|gbp|btc|eth", re.I)
                    currency_match = currency_pattern.search(line)
                    if currency_match:
                        currency_pos = currency_match.start()
                        word_pos = line.lower().find(word.lower())
                        if word_pos != -1 and word_pos < currency_pos:
                            distance = currency_pos - (word_pos + len(word))
                            if 0 < distance < 20:
                                confidence = 0.98
                            else:
                                confidence = 0.95
                        elif word_pos != -1:
                            confidence = 0.70
                    elif "balance" in line_lower:
                        balance_pos = line_lower.find("balance")
                        word_pos = line_lower.find(word.lower())
                        confidence = (
                            0.90 if word_pos != -1 and word_pos < balance_pos else 0.85
                        )
                    elif any(indicator in line_lower for indicator in ["player", "user", "logged"]):
                        confidence = 0.85
                    elif len(word) >= 6:
                        confidence = 0.75

                    candidates.append((word, confidence))

    if not candidates:
        return None, 0.0

    best = max(candidates, key=lambda x: x[1])
    return best[0], best[1]


def extract_nickname_with_retry(hwnd: int, max_attempts: int = 3) -> tuple[str | None, float]:
    """Extract nickname with smart retry and increasing delays."""
    delays = [2, 5, 10]
    best_name = None
    best_confidence = 0.0

    print(f"[NicknameDetector] Extracting nickname ({max_attempts} attempts)...")

    for attempt in range(max_attempts):
        print(f"[NicknameDetector] Attempt {attempt + 1}/{max_attempts}...")

        try:
            if not WIN32_AVAILABLE or not win32gui.IsWindow(hwnd):
                print("[NicknameDetector] Window closed. Stopping extraction...")
                break

            img = grab_window(hwnd)
            if not img:
                print(f"[NicknameDetector] Could not capture window")
                if attempt < max_attempts - 1:
                    time.sleep(delays[min(attempt, len(delays) - 1)])
                continue

            # Strategy 1: Try with region cropping and red filter first
            text = ocr_text(img, use_region=True, use_color_filter=True)
            method = "region + red filter"

            # Strategy 2: If no text found, try without color filter
            if not text or len(text.strip()) < 3:
                print(f"[NicknameDetector] Attempt {attempt + 1}: No red text found, trying without color filter...")
                text = ocr_text(img, use_region=True, use_color_filter=False)
                method = "region only"

            # Strategy 3: If still no text, try full window OCR
            if not text or len(text.strip()) < 3:
                print(f"[NicknameDetector] Attempt {attempt + 1}: No text in region, trying full window OCR...")
                text = ocr_text(img, use_region=False, use_color_filter=False)
                method = "full window"

            if text:
                preview = text.strip()[:100].replace("\n", " ")
                print(f"[NicknameDetector] Attempt {attempt + 1}: OCR text ({method}): {preview}...")

            if not text or len(text.strip()) < 2:
                print(f"[NicknameDetector] Attempt {attempt + 1}: Insufficient text found")
                if attempt < max_attempts - 1:
                    time.sleep(delays[min(attempt, len(delays) - 1)])
                continue

            # Extract nickname
            extracted_name, extracted_confidence = extract_player_name_from_lobby(hwnd, text)

            if extracted_name:
                if extracted_confidence > best_confidence:
                    best_name = extracted_name
                    best_confidence = extracted_confidence
                    print(
                        f"[NicknameDetector] Attempt {attempt + 1}: Found nickname: {best_name} ({int(extracted_confidence * 100)}% confidence)"
                    )

                # Stop early if high confidence
                if extracted_confidence >= 0.8:
                    print(
                        f"[NicknameDetector] High confidence ({int(extracted_confidence * 100)}%), stopping after {attempt + 1} attempts"
                    )
                    break
            else:
                print(f"[NicknameDetector] Attempt {attempt + 1}: No nickname found in OCR text")

            # Wait before next attempt
            if attempt < max_attempts - 1:
                delay = delays[min(attempt, len(delays) - 1)]
                time.sleep(delay)

        except Exception as e:
            print(f"[NicknameDetector] Error in attempt {attempt + 1}: {e}")
            if attempt < max_attempts - 1:
                time.sleep(delays[min(attempt, len(delays) - 1)])

    return best_name, best_confidence


# Track which HWND/PID combinations have already sent signals to prevent duplicates
_detected_combinations: set[tuple[int, int]] = set()
_detection_lock = threading.Lock()

def detect_nickname(hwnd: int, pid: int, post_signal_func) -> None:
    """
    Main function to detect nickname from CoinPoker lobby window.
    
    Args:
        hwnd: Window handle of CoinPoker lobby window
        pid: Process ID of CoinPoker
        post_signal_func: Function to call to send signals (from core.api.post_signal)
    """
    # Prevent duplicate detections for same HWND/PID combination
    with _detection_lock:
        combination = (hwnd, pid)
        if combination in _detected_combinations:
            print(f"[NicknameDetector] Skipping duplicate detection for HWND: {hwnd}, PID: {pid}")
            return
        _detected_combinations.add(combination)
    
    # Check if Tesseract is available
    tesseract_available = ensure_tesseract()

    if not tesseract_available:
        print("[NicknameDetector] Tesseract OCR not found - nickname detection disabled")
        # Send signal that Tesseract is missing
        try:
            hostname = socket.gethostname()
            import hashlib
            device_id = hashlib.md5(hostname.encode()).hexdigest()

            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                device_ip = s.getsockname()[0]
                s.close()
            except Exception:
                device_ip = "127.0.0.1"

            details = json.dumps({
                "message": "Tesseract OCR not installed - nickname detection disabled",
                "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
                "expected_path": TESSERACT_EXE,
                "pid": pid,
            })

            post_signal_func(
                category="system",
                name="Player Name Detection - Tesseract Required",
                status="WARN",
                details=details,
                device_id=device_id,
                device_name=hostname,
                device_ip=device_ip,
                segment_name="ProcessScanner",
            )
        except Exception:
            pass
        return

    # Extract nickname with retry
    player_name, confidence = extract_nickname_with_retry(hwnd, max_attempts=3)

    # Send result to dashboard
    if player_name:
        try:
            hostname = socket.gethostname()
            import hashlib
            device_id = hashlib.md5(hostname.encode()).hexdigest()

            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                device_ip = s.getsockname()[0]
                s.close()
            except Exception:
                device_ip = "127.0.0.1"

            details = json.dumps({
                "player_name": player_name,
                "confidence": confidence,
                "confidence_percent": int(confidence * 100),
                "pid": pid,
                "detection_method": "OCR",
            })

            post_signal_func(
                category="system",
                name="Player Name Detected",
                status="INFO",
                details=details,
                device_id=device_id,
                device_name=hostname,
                device_ip=device_ip,
                segment_name="ProcessScanner",
            )

            print(
                f"[NicknameDetector] ✅ Sent player name to dashboard: {player_name} ({int(confidence * 100)}% confidence)"
            )
        except Exception as e:
            print(f"[NicknameDetector] Failed to send player name: {e}")
    else:
        print("[NicknameDetector] Could not extract nickname after 3 attempts")
        # Send failure signal
        try:
            hostname = socket.gethostname()
            import hashlib
            device_id = hashlib.md5(hostname.encode()).hexdigest()

            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                device_ip = s.getsockname()[0]
                s.close()
            except Exception:
                device_ip = "127.0.0.1"

            post_signal_func(
                category="system",
                name="Player Name Detection Failed",
                status="WARN",
                details=json.dumps({
                    "attempts": 3,
                    "reason": "Could not extract nickname from lobby",
                    "pid": pid,
                }),
                device_id=device_id,
                device_name=hostname,
                device_ip=device_ip,
                segment_name="ProcessScanner",
            )
        except Exception:
            pass

