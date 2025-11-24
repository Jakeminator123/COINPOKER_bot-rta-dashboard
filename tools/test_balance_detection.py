#!/usr/bin/env python3
"""
Test script to detect Balance area and create nickname region to the left.
"""

import sys
import os
import time
from pathlib import Path
import pytesseract
from PIL import Image
from pytesseract import Output

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

try:
    import win32gui
    import win32process
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

from utils.nickname_detector import (  # noqa: E402
    grab_window,
    filter_red_text,
    ensure_tesseract,
    get_username_crop_box,
    TESSERACT_EXE,
    TESSDATA_DIR,
)
from scanner import CoinPokerDetector  # noqa: E402

_detector_instance: CoinPokerDetector | None = None


def _get_coinpoker_detector() -> CoinPokerDetector:
    """Lazy-load CoinPokerDetector (re-uses same logic as scanner.py)."""
    global _detector_instance
    if _detector_instance is None:
        print("[Detector] Initializing CoinPokerDetector (from scanner.py)...")
        _detector_instance = CoinPokerDetector()
    return _detector_instance


def find_balance_region(image: Image.Image) -> tuple[int, int, int, int] | None:
    """
    Find the region containing "Balance" text using OCR.
    Uses method 1: region + red filter (only method to use).
    Returns (left, top, right, bottom) or None if not found.
    """
    try:
        # First try: Use method 1 - region + red filter
        crop_left, crop_top, crop_right, crop_bottom = get_username_crop_box(image, use_auto_config=True)
        processed_image = image.crop((crop_left, crop_top, crop_right, crop_bottom))
        filtered_image = filter_red_text(processed_image.copy(), tolerance=50, use_auto_config=True)
        
        # Get OCR data with bounding boxes
        ocr_data = pytesseract.image_to_data(filtered_image, lang="eng+osd", output_type=Output.DICT)
        
        if ocr_data and "text" in ocr_data:
            # Find "Balance" word
            for i, text in enumerate(ocr_data["text"]):
                if text and "balance" in text.lower():
                    balance_left = ocr_data["left"][i]
                    balance_top = ocr_data["top"][i]
                    balance_width = ocr_data["width"][i]
                    balance_height = ocr_data["height"][i]
                    balance_right = balance_left + balance_width
                    balance_bottom = balance_top + balance_height
                    
                    # Convert coordinates back to original image space
                    # (crop_username_region crops from upper-right, so we need to adjust)
                    # Adjust coordinates to original image
                    orig_left = balance_left + crop_left
                    orig_top = balance_top + crop_top
                    orig_right = balance_right + crop_left
                    orig_bottom = balance_bottom + crop_top
                    
                    return (orig_left, orig_top, orig_right, orig_bottom)
        
        # Fallback: Try full image with red filter
        print("  Trying full image with red filter...")
        filtered_full = filter_red_text(image.copy(), tolerance=50, use_auto_config=True)
        ocr_data_full = pytesseract.image_to_data(filtered_full, lang="eng+osd", output_type=Output.DICT)
        
        if ocr_data_full and "text" in ocr_data_full:
            for i, text in enumerate(ocr_data_full["text"]):
                if text and "balance" in text.lower():
                    balance_left = ocr_data_full["left"][i]
                    balance_top = ocr_data_full["top"][i]
                    balance_width = ocr_data_full["width"][i]
                    balance_height = ocr_data_full["height"][i]
                    balance_right = balance_left + balance_width
                    balance_bottom = balance_top + balance_height
                    return (balance_left, balance_top, balance_right, balance_bottom)
        
        # Last resort: Try without filter
        print("  Trying without filter...")
        ocr_data_plain = pytesseract.image_to_data(image, lang="eng+osd", output_type=Output.DICT)
        
        if ocr_data_plain and "text" in ocr_data_plain:
            for i, text in enumerate(ocr_data_plain["text"]):
                if text and "balance" in text.lower():
                    balance_left = ocr_data_plain["left"][i]
                    balance_top = ocr_data_plain["top"][i]
                    balance_width = ocr_data_plain["width"][i]
                    balance_height = ocr_data_plain["height"][i]
                    balance_right = balance_left + balance_width
                    balance_bottom = balance_top + balance_height
                    return (balance_left, balance_top, balance_right, balance_bottom)
        
        return None
        
    except Exception as e:
        print(f"Error finding Balance region: {e}")
        import traceback
        traceback.print_exc()
        return None


def create_nickname_region_from_balance(
    image: Image.Image,
    balance_region: tuple[int, int, int, int]
) -> Image.Image | None:
    """
    Create nickname region based on Balance reference area.
    
    New region:
    - 20% higher (top - 20% of height)
    - 20% lower (bottom + 20% of height)
    - 300% wider (3x width)
    - Positioned so right edge ends where Balance left edge starts
    """
    try:
        img_width, img_height = image.size
        balance_left, balance_top, balance_right, balance_bottom = balance_region
        
        # Calculate reference region dimensions
        ref_width = balance_right - balance_left
        ref_height = balance_bottom - balance_top
        
        print(f"Reference Balance dimensions: width={ref_width}, height={ref_height}")
        
        # New region dimensions
        new_height = int(ref_height * 1.4)  # 20% higher + 20% lower = 40% total = 1.4x
        new_width = int(ref_width * 3.0)    # 300% wider = 3x
        
        # Calculate position: right edge of new region = left edge of Balance
        new_right = balance_left
        new_left = new_right - new_width
        
        # Adjust top: 20% higher (subtract 20% of ref_height)
        height_adjust = int(ref_height * 0.2)
        new_top = balance_top - height_adjust
        
        # Adjust bottom: 20% lower (add 20% of ref_height)
        new_bottom = balance_bottom + height_adjust
        
        # Ensure coordinates are within image bounds
        if new_left < 0:
            # If region extends beyond left edge, adjust
            new_right = new_right - new_left  # Shift right to compensate
            new_left = 0
        
        new_left = max(0, new_left)
        new_top = max(0, new_top)
        new_right = min(img_width, new_right)
        new_bottom = min(img_height, new_bottom)
        
        # Final dimensions
        final_width = new_right - new_left
        final_height = new_bottom - new_top
        
        # Crop the region
        nickname_region = image.crop((new_left, new_top, new_right, new_bottom))
        
        print(f"Balance region: ({balance_left}, {balance_top}, {balance_right}, {balance_bottom})")
        print(f"Nickname region: ({new_left}, {new_top}, {new_right}, {new_bottom})")
        print(f"  Calculated width: {new_width}, Final width: {final_width}")
        print(f"  Calculated height: {new_height}, Final height: {final_height}")
        
        return nickname_region
        
    except Exception as e:
        print(f"Error creating nickname region: {e}")
        import traceback
        traceback.print_exc()
        return None


def find_coinpoker_lobby_window(quiet: bool = False):
    """Find CoinPoker lobby window using same detector as scanner.py, with fallback."""
    if not WIN32_AVAILABLE:
        return None, None

    # Primary: use the same detector logic as scanner.py
    try:
        detector = _get_coinpoker_detector()
        hwnd, pid = detector.find_lobby_window()
        if hwnd and pid:
            if not quiet:
                print(f"[Detector] Found CoinPoker lobby window: HWND={hwnd}, PID={pid}")
            return hwnd, pid
    except Exception as exc:
        if not quiet:
            print(f"[Detector] Lobby search error: {exc}")

    # Fallback: scan visible windows for titles containing "coinpoker" + "lobby"
    target_hwnd = None
    target_pid = None

    def enum_fallback(hwnd, _):
        nonlocal target_hwnd, target_pid
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True

            title = win32gui.GetWindowText(hwnd) or ""
            tl = title.lower()
            if "coinpoker" in tl and "lobby" in tl:
                target_hwnd = hwnd
                _, target_pid = win32process.GetWindowThreadProcessId(hwnd)
                if not quiet:
                    print(f"[Fallback] Matched window '{title}' (HWND={hwnd}, PID={target_pid})")
                return False
        except Exception:
            pass
        return True

    try:
        win32gui.EnumWindows(enum_fallback, None)
    except Exception as exc:
        if not quiet:
            print(f"[Fallback] EnumWindows failed: {exc}")
        return None, None
    if target_hwnd and target_pid:
        return target_hwnd, target_pid

    if not quiet:
        print("[Fallback] CoinPoker lobby window not found. Is the lobby visible?")
    return None, None


def test_with_image_files():
    """Test with balance.png and balance_blackandwhite.png files."""
    debug_dir = project_root / "nickname_debug"
    
    # Try balance_blackandwhite.png first (better for OCR)
    test_image_path = debug_dir / "balance_blackandwhite.png"
    if not test_image_path.exists():
        test_image_path = debug_dir / "balance.png"
    
    if not test_image_path.exists():
        print(f"Error: Could not find balance.png or balance_blackandwhite.png in {debug_dir}")
        return
    
    print(f"Loading test image: {test_image_path.name}")
    image = Image.open(test_image_path)
    print(f"Image size: {image.size}")
    
    # Find Balance region using method 1 (region + red filter)
    print("\n[Step 1] Finding Balance region using method 1 (region + red filter)...")
    balance_region = find_balance_region(image)
    
    if not balance_region:
        print("ERROR: Could not find Balance region!")
        return
    
    print(f"[SUCCESS] Balance region found: {balance_region}")
    
    # Create nickname region
    print("\n[Step 2] Creating nickname region to the left of Balance...")
    nickname_region = create_nickname_region_from_balance(image, balance_region)
    
    if not nickname_region:
        print("ERROR: Could not create nickname region!")
        return
    
    # Save nickname region for inspection
    output_path = debug_dir / "nickname_region_from_balance.png"
    nickname_region.save(output_path)
    print(f"[SUCCESS] Nickname region saved to: {output_path.name}")
    
    # OCR the nickname region
    print("\n[Step 3] OCR-ing nickname region...")
    try:
        # Apply red filter to nickname region
        filtered_nickname = filter_red_text(nickname_region.copy(), tolerance=50, use_auto_config=True)
        nickname_text = pytesseract.image_to_string(filtered_nickname, lang="eng+osd")
        
        print("OCR Text from nickname region:")
        print("-" * 60)
        print(nickname_text)
        print("-" * 60)
        
        # Save filtered version too
        filtered_output = debug_dir / "nickname_region_from_balance_filtered.png"
        filtered_nickname.save(filtered_output)
        print(f"Filtered nickname region saved to: {filtered_output.name}")
        
    except Exception as e:
        print(f"Error OCR-ing nickname region: {e}")


def wait_for_coinpoker_lobby_window(timeout_seconds: float = 300.0, poll_interval: float = 2.0):
    """Wait for CoinPoker-lobby window to appear (like scanner.py does)."""
    if not WIN32_AVAILABLE:
        return None, None
    
    deadline = time.time() + max(0.0, timeout_seconds)
    interval = max(0.5, poll_interval)
    last_progress_time = 0
    
    print(f"\n[Waiting] Waiting for CoinPoker-lobby window (timeout={timeout_seconds}s, checking every {interval}s)...")
    print("Please start CoinPoker and log in to the lobby...")
    
    while time.time() < deadline:
        # Call with quiet=True to suppress output during waiting
        hwnd, pid = find_coinpoker_lobby_window(quiet=True)
        
        if hwnd and pid:
            print("\n[SUCCESS] CoinPoker-lobby window found!")
            return hwnd, pid
        
        # Show progress every 10 seconds
        now = time.time()
        if now - last_progress_time >= 10.0:
            remaining = int(deadline - now)
            print(f"  Still waiting... ({remaining}s remaining)")
            last_progress_time = now
        
        time.sleep(interval)
    
    return None, None


def test_with_live_window():
    """Test with live CoinPoker-lobby window - waits for CoinPoker to start."""
    if not WIN32_AVAILABLE:
        print("Windows API not available - skipping live window test")
        return
    
    if not ensure_tesseract():
        print("Tesseract OCR not found - skipping live window test")
        return
    
    # Wait for CoinPoker-lobby window (like scanner.py does)
    hwnd, pid = wait_for_coinpoker_lobby_window(timeout_seconds=300.0, poll_interval=2.0)
    
    if not hwnd or not pid:
        print("\nERROR: Could not find CoinPoker-lobby window within timeout!")
        print("Make sure CoinPoker is running and you have logged in to the lobby.")
        return
    
    print(f"[SUCCESS] Found CoinPoker-lobby window: HWND={hwnd}, PID={pid}")
    
    # Capture window
    print("\n[Step 1] Capturing window...")
    image = grab_window(hwnd)
    
    if not image:
        print("ERROR: Could not capture window!")
        return
    
    print(f"Window captured: {image.size}")
    
    # Find Balance region using method 1 (region + red filter)
    print("\n[Step 2] Finding Balance reference area using method 1 (region + red filter)...")
    balance_region = find_balance_region(image)
    
    if not balance_region:
        print("ERROR: Could not find Balance reference area!")
        print("Make sure the Balance text is visible in the lobby window.")
        return
    
    print(f"[SUCCESS] Balance reference area found: {balance_region}")
    balance_left, balance_top, balance_right, balance_bottom = balance_region
    print(f"  Coordinates: left={balance_left}, top={balance_top}, right={balance_right}, bottom={balance_bottom}")
    
    # Create nickname region (20% higher, 20% lower, 300% wider, positioned to the left)
    print("\n[Step 3] Creating nickname region to the left of Balance...")
    nickname_region = create_nickname_region_from_balance(image, balance_region)
    
    if not nickname_region:
        print("ERROR: Could not create nickname region!")
        return
    
    # Save the OCR region for inspection
    debug_dir = project_root / "nickname_debug"
    debug_dir.mkdir(exist_ok=True)
    
    output_path = debug_dir / "nickname_region_live.png"
    nickname_region.save(output_path)
    print(f"[SUCCESS] Nickname region saved to: {output_path.name}")
    
    # OCR the nickname region
    print("\n[Step 4] OCR-ing nickname region...")
    try:
        # Apply red filter for better OCR
        filtered_nickname = filter_red_text(nickname_region.copy(), tolerance=50, use_auto_config=True)
        
        # Perform OCR
        nickname_text = pytesseract.image_to_string(filtered_nickname, lang="eng+osd")
        
        # Print OCR results
        print("\n" + "=" * 60)
        print("OCR RESULT FROM NICKNAME REGION:")
        print("=" * 60)
        if nickname_text.strip():
            print(nickname_text.strip())
        else:
            print("(No text detected)")
        print("=" * 60)
        
        # Save filtered version
        filtered_output = debug_dir / "nickname_region_live_filtered.png"
        filtered_nickname.save(filtered_output)
        print(f"\nFiltered nickname region saved to: {filtered_output.name}")
        
        # Also try OCR with data to see individual words
        print("\n[Step 5] Detailed OCR analysis...")
        ocr_data = pytesseract.image_to_data(filtered_nickname, lang="eng+osd", output_type=Output.DICT)
        
        if ocr_data and "text" in ocr_data:
            detected_words = []
            for i, text in enumerate(ocr_data["text"]):
                if text and text.strip():
                    conf = ocr_data.get("conf", [0])[i] if i < len(ocr_data.get("conf", [])) else 0
                    detected_words.append((text.strip(), conf))
            
            if detected_words:
                print("Detected words:")
                for word, conf in detected_words:
                    print(f"  - '{word}' (confidence: {conf}%)")
        
    except Exception as e:
        print(f"Error OCR-ing nickname region: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Configure Tesseract path
    if Path(TESSERACT_EXE).exists():
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_EXE
        if Path(TESSDATA_DIR).exists():
            os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR
    
    # Check if Tesseract is available
    try:
        pytesseract.get_tesseract_version()
        print("Tesseract OCR: OK")
    except Exception as e:
        print(f"WARNING: Tesseract OCR not available: {e}")
        print(f"Expected path: {TESSERACT_EXE}")
        print("Some tests may fail.")
    
    print("=" * 60)
    print("Balance Detection & Nickname Region Test")
    print("=" * 60)
    
    # Ask user which test to run
    print("\nChoose test mode:")
    print("  1. Test with image files (balance.png)")
    print("  2. Test with live CoinPoker-lobby window (waits for CoinPoker)")
    print("  3. Run both tests")
    
    try:
        choice = input("\nEnter choice (1/2/3) [default: 2]: ").strip()
        if not choice:
            choice = "2"
    except (EOFError, KeyboardInterrupt):
        print("\nCancelled.")
        sys.exit(0)
    
    if choice == "1":
        print("\n[TEST 1] Testing with image files...")
        test_with_image_files()
    elif choice == "2":
        print("\n" + "=" * 60)
        print("[TEST 2] Testing with live CoinPoker-lobby window...")
        print("=" * 60)
        test_with_live_window()
    elif choice == "3":
        print("\n[TEST 1] Testing with image files...")
        test_with_image_files()
        print("\n" + "=" * 60)
        print("[TEST 2] Testing with live CoinPoker-lobby window...")
        print("=" * 60)
        test_with_live_window()
    else:
        print(f"Invalid choice: {choice}")
        sys.exit(1)
    
    print("\nDone!")

