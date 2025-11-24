# nickname_detector.py
"""
Nickname detection using OCR on CoinPoker lobby window.
Integrated directly into ProcessScanner - no separate process needed.
"""

import hashlib
import json
import os
import re
import socket
import threading
import time
from pathlib import Path

import numpy as np
import pytesseract
from PIL import Image, ImageEnhance, ImageGrab
from pytesseract import Output
from core.system_info import get_windows_computer_name

try:
    import win32gui
    import win32ui
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

# Tesseract configuration
TESSERACT_EXE = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
TESSDATA_DIR = r"C:\Program Files\Tesseract-OCR\tessdata"

NICKNAME_CONFIG_FILENAME = "nickname_region_config.json"

EXCLUDED_WORDS = {
    "coinpoker",
    "lobby",
    "cash",
    "games",
    "tournaments",
    "sit",
    "go",
    "wallet",
    "profile",
    "settings",
    "help",
    "login",
    "register",
    "hold'em",
    "omaha",
    "poker",
    "table",
    "seat",
    "blinds",
    "ante",
    "chips",
    "balance",
    "deposit",
    "withdraw",
    "history",
    "leaderboard",
    "learnedconfig",
    "learned",
    "config",
    "region",
    "nickname",
}

USERNAME_PATTERNS = [
    re.compile(r"^[A-Za-z][A-Za-z0-9_\.-]{2,20}$"),
    re.compile(r"[A-Za-z][A-Za-z0-9_\.-]{2,20}"),
]

WORD_SPLIT_PATTERN = re.compile(r"[\s\-_\|/]+")
CURRENCY_ONLY_PATTERN = re.compile(r"^[\d₮$€£¥]+$")
DISALLOWED_CHARS_PATTERN = re.compile(r"[\\\'\"<>{}\[\]|`~]")
CURRENCY_PATTERN = re.compile(r"[¥$€£₮]|chp|usd|eur|gbp|btc|eth", re.I)
BALANCE_KEYWORDS = {"balance"}


def _prepare_candidate_word(word: str) -> str | None:
    """Normalize word and validate if it can represent a username."""
    if not word:
        return None

    candidate = word.strip().strip("|:;,.()[]{}")
    if len(candidate) < 3:
        return None

    lower_candidate = candidate.lower()
    if lower_candidate in EXCLUDED_WORDS:
        return None

    if candidate.isdigit():
        return None

    if CURRENCY_ONLY_PATTERN.match(candidate):
        return None

    if DISALLOWED_CHARS_PATTERN.search(candidate):
        return None

    for pattern in USERNAME_PATTERNS:
        if pattern.match(candidate):
            return candidate

    return None


def _group_ocr_words_by_line(ocr_data: dict) -> list[list[dict]]:
    """Group pytesseract OCR data into ordered lines."""
    if not ocr_data or "text" not in ocr_data:
        return []

    grouped: dict[tuple[int, int, int], list[dict]] = {}

    total_items = len(ocr_data["text"])
    for idx in range(total_items):
        text = ocr_data["text"][idx]
        if not isinstance(text, str):
            continue
        stripped = text.strip()
        if not stripped:
            continue

        key = (
            ocr_data.get("block_num", [0])[idx],
            ocr_data.get("par_num", [0])[idx],
            ocr_data.get("line_num", [0])[idx],
        )

        conf_list = ocr_data.get("conf")
        try:
            conf = float(conf_list[idx]) if conf_list else -1.0
        except (ValueError, TypeError, IndexError):
            conf = -1.0

        word_payload = {
            "text": stripped,
            "left": int(ocr_data.get("left", [0])[idx]),
            "top": int(ocr_data.get("top", [0])[idx]),
            "width": int(ocr_data.get("width", [0])[idx]),
            "height": int(ocr_data.get("height", [0])[idx]),
            "conf": conf,
        }

        grouped.setdefault(key, []).append(word_payload)

    ordered_lines: list[list[dict]] = []
    for words in grouped.values():
        words.sort(key=lambda item: item["left"])
        ordered_lines.append(words)

    ordered_lines.sort(key=lambda line: (line[0]["top"], line[0]["left"]))
    return ordered_lines


def _find_candidate_left_of_index(words: list[dict], idx: int) -> tuple[str, float] | None:
    """Return the closest valid username candidate left of a given index."""
    for word in reversed(words[:idx]):
        candidate = _prepare_candidate_word(word["text"])
        if not candidate:
            continue

        conf = word["conf"] if word["conf"] >= 0 else 75.0
        normalized_conf = min(0.99, max(0.6, conf / 100))
        return candidate, normalized_conf

    return None



def _resolve_device_identity() -> tuple[str, str]:
    """Return consistent hostname/device_id shared with scanner + Redis."""
    hostname = get_windows_computer_name()
    if not hostname or hostname == "Unknown Device":
        try:
            hostname = socket.gethostname()
        except Exception:
            hostname = "Unknown Device"
    device_id = hashlib.md5(hostname.encode()).hexdigest()
    return hostname, device_id


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
    return_data: bool = False,
) -> str | tuple[str, dict | None]:
    """OCR text (and optionally data) from image with optional preprocessing."""

    def _image_to_string_safe(target: Image.Image) -> str:
        try:
            return pytesseract.image_to_string(target, lang="eng+osd")
        except Exception:
            try:
                return pytesseract.image_to_string(target)
            except Exception:
                return ""

    def _image_to_data_safe(target: Image.Image) -> dict | None:
        try:
            return pytesseract.image_to_data(target, lang="eng+osd", output_type=Output.DICT)
        except Exception:
            try:
                return pytesseract.image_to_data(target, output_type=Output.DICT)
            except Exception:
                return None

    processed_image = image
    try:
        if use_region:
            processed_image = crop_username_region(processed_image, use_auto_config=use_auto_config)

        if use_color_filter:
            processed_image = filter_red_text(
                processed_image, tolerance=30, use_auto_config=use_auto_config
            )
    except Exception:
        processed_image = image

    text = _image_to_string_safe(processed_image)

    if not return_data:
        return text

    data = _image_to_data_safe(processed_image)
    return text, data



def extract_player_name_from_lobby(hwnd: int, ocr_text: str) -> tuple[str | None, float]:
    """Extract nickname from CoinPoker lobby window using plain OCR text."""
    lines = [ln.strip() for ln in ocr_text.splitlines() if ln.strip()]
    candidates: list[tuple[str, float]] = []

    for line in lines:
        words = WORD_SPLIT_PATTERN.split(line)
        line_lower = line.lower()

        for raw_word in words:
            candidate = _prepare_candidate_word(raw_word)
            if not candidate:
                continue

            confidence = 0.5

            currency_match = CURRENCY_PATTERN.search(line)
            if currency_match:
                currency_pos = currency_match.start()
                word_pos = line_lower.find(candidate.lower())
                if word_pos != -1 and word_pos < currency_pos:
                    distance = currency_pos - (word_pos + len(candidate))
                    if 0 < distance < 20:
                        confidence = 0.98
                    else:
                        confidence = 0.95
                elif word_pos != -1:
                    confidence = 0.70
            elif "balance" in line_lower:
                balance_pos = line_lower.find("balance")
                word_pos = line_lower.find(candidate.lower())
                confidence = 0.90 if word_pos != -1 and word_pos < balance_pos else 0.85
            elif any(indicator in line_lower for indicator in ["player", "user", "logged"]):
                confidence = 0.85
            elif len(candidate) >= 6:
                confidence = 0.75

            candidates.append((candidate, confidence))

    if not candidates:
        return None, 0.0

    best = max(candidates, key=lambda x: x[1])
    return best[0], best[1]


def extract_player_name_from_ocr_data(ocr_data: dict | None) -> tuple[str | None, float]:
    """Use positional OCR data to locate nickname near stable UI keywords."""
    if not ocr_data:
        return None, 0.0

    try:
        lines = _group_ocr_words_by_line(ocr_data)
        if not lines:
            return None, 0.0

        # Pass 1: look for explicit Balance keyword and take the closest valid word to the left.
        for words in lines:
            for idx, word in enumerate(words):
                normalized = word["text"].strip().lower().strip(":|")
                if normalized not in BALANCE_KEYWORDS:
                    continue

                candidate = _find_candidate_left_of_index(words, idx)
                if candidate:
                    candidate_name, candidate_conf = candidate
                    return candidate_name, max(0.9, candidate_conf)

        # Pass 2: fallback to the highest-confidence candidate near the top portion of the window.
        max_bottom = max((w["top"] + w["height"] for line in lines for w in line), default=0)
        top_threshold = max_bottom * 0.35 if max_bottom else 300

        best_candidate: tuple[str, float] | None = None
        for words in lines:
            for word in words:
                if word["top"] > top_threshold:
                    continue

                candidate_value = _prepare_candidate_word(word["text"])
                if not candidate_value:
                    continue

                conf = word["conf"] if word["conf"] >= 0 else 75.0
                normalized_conf = min(0.9, max(0.5, conf / 100))

                if not best_candidate or normalized_conf > best_candidate[1]:
                    best_candidate = (candidate_value, normalized_conf)

        if best_candidate:
            return best_candidate
    except Exception:
        return None, 0.0

    return None, 0.0


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
                print("[NicknameDetector] Could not capture window")
                if attempt < max_attempts - 1:
                    time.sleep(delays[min(attempt, len(delays) - 1)])
                continue

            # Strategy 1: Try with region cropping and red filter first
            text, ocr_data = ocr_text(
                img, use_region=True, use_color_filter=True, return_data=True
            )
            method = "region + red filter"

            # Strategy 2: If no text found, try without color filter
            if not text or len(text.strip()) < 3:
                print(f"[NicknameDetector] Attempt {attempt + 1}: No red text found, trying without color filter...")
                text, ocr_data = ocr_text(
                    img, use_region=True, use_color_filter=False, return_data=True
                )
                method = "region only"

            # Strategy 3: If still no text, try full window OCR
            if not text or len(text.strip()) < 3:
                print(f"[NicknameDetector] Attempt {attempt + 1}: No text in region, trying full window OCR...")
                text, ocr_data = ocr_text(
                    img, use_region=False, use_color_filter=False, return_data=True
                )
                method = "full window"

            if text:
                preview = text.strip()[:100].replace("\n", " ")
                print(f"[NicknameDetector] Attempt {attempt + 1}: OCR text ({method}): {preview}...")

            if not text or len(text.strip()) < 2:
                print(f"[NicknameDetector] Attempt {attempt + 1}: Insufficient text found")
                if attempt < max_attempts - 1:
                    time.sleep(delays[min(attempt, len(delays) - 1)])
                continue

            # Extract nickname with positional data first, fallback to text heuristics
            extracted_name, extracted_confidence = extract_player_name_from_ocr_data(ocr_data)
            if not extracted_name:
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
            hostname, device_id = _resolve_device_identity()

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
            hostname, device_id = _resolve_device_identity()

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
            hostname, device_id = _resolve_device_identity()

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

