"""
Screen Recorder Utility
=======================
Records screen capture for specified duration and saves as MP4 video file.
Uses mss for screen capture and opencv-python for video encoding.

Optimized for low CPU usage and browser-compatible output (H.264).
Uses bundled ffmpeg via imageio-ffmpeg for portable H.264 encoding.

Multi-monitor support: Captures all monitors combined (virtual screen).
"""

import os
import sys
import time
import tempfile
import subprocess
import shutil
from pathlib import Path
from typing import Optional

try:
    import mss
    import numpy as np
    import cv2
    AVAILABLE = True
    IMPORT_ERROR = None
except ImportError as e:
    AVAILABLE = False
    IMPORT_ERROR = str(e)

# Try to get bundled ffmpeg from imageio-ffmpeg (works in .exe builds)
FFMPEG_PATH = None
try:
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    pass  # Will fallback to system ffmpeg or skip transcode


def get_monitor_info() -> dict:
    """
    Get information about all monitors.
    
    Returns:
        dict with 'monitors' list and 'all' for combined virtual screen
    """
    if not AVAILABLE:
        return {"monitors": [], "all": None}
    
    with mss.mss() as sct:
        # monitors[0] is the combined virtual screen (all monitors)
        # monitors[1] is primary monitor
        # monitors[2+] are additional monitors
        return {
            "monitors": sct.monitors[1:],  # Individual monitors (skip virtual)
            "all": sct.monitors[0],  # Combined virtual screen
            "count": len(sct.monitors) - 1,  # Number of physical monitors
        }


def record_screen(duration_seconds: int, output_path: Optional[str] = None, monitor_index: Optional[int] = None) -> str:
    """
    Record screen for specified duration and save as MP4 video.
    
    Supports multi-monitor setups by capturing all monitors combined (default)
    or a specific monitor if monitor_index is provided.
    
    Args:
        duration_seconds: Duration to record in seconds (min 1, max 600)
        output_path: Optional path to save video. If None, uses temp directory.
        monitor_index: Optional monitor index to capture.
            - None or 0: Capture all monitors combined (virtual screen) - DEFAULT
            - 1: Primary monitor only
            - 2+: Specific additional monitor
    
    Returns:
        Path to saved video file (H.264 if ffmpeg available, otherwise mp4v)
    
    Raises:
        ValueError: If duration is invalid or dependencies are missing
        RuntimeError: If recording fails
    """
    if not AVAILABLE:
        raise RuntimeError(f"Screen recording dependencies missing: {IMPORT_ERROR}")
    
    # Validate duration
    if duration_seconds < 1:
        raise ValueError("Duration must be at least 1 second")
    if duration_seconds > 600:  # 10 minutes max
        raise ValueError("Duration cannot exceed 600 seconds (10 minutes)")
    
    # Setup output path
    if output_path is None:
        temp_dir = tempfile.gettempdir()
        timestamp = int(time.time())
        output_path = os.path.join(temp_dir, f"recording_{timestamp}.mp4")
    
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Screen capture settings - balance quality/size/CPU
    fps = 12  # Slightly higher fps for smoother video
    frame_time = 1.0 / fps

    # Get screen dimensions - use monitor index 0 for all monitors combined
    # monitors[0] = combined virtual screen (all monitors)
    # monitors[1] = primary monitor
    # monitors[2+] = additional monitors
    with mss.mss() as sct:
        # Default to all monitors combined (index 0) for multi-monitor support
        selected_index = monitor_index if monitor_index is not None else 0
        
        # Validate monitor index
        if selected_index >= len(sct.monitors):
            print(f"[ScreenRecorder] Warning: Monitor index {selected_index} not found, using all monitors")
            selected_index = 0
        
        monitor = sct.monitors[selected_index]
        width = monitor["width"]
        height = monitor["height"]
        
        monitor_desc = "all monitors combined" if selected_index == 0 else f"monitor {selected_index}"
        print(f"[ScreenRecorder] Selected {monitor_desc}: {width}x{height}")

    # Downscale to 900p max (better than 720p, still smaller than 1080p)
    max_w, max_h = 1600, 900
    scale = min(max_w / width, max_h / height, 1.0)
    target_w = int(width * scale)
    target_h = int(height * scale)
    # Ensure even dimensions for codec compatibility
    if target_w % 2 == 1:
        target_w -= 1
    if target_h % 2 == 1:
        target_h -= 1
    target_size = (target_w, target_h)

    # Use mp4v codec (works without OpenH264); we'll transcode to H.264 after
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    video_writer = cv2.VideoWriter(str(output_path), fourcc, fps, target_size)
    
    if not video_writer.isOpened():
        raise RuntimeError("Failed to initialize video writer")
    
    def _transcode_to_h264(path: Path) -> Path:
        """
        Transcode to H.264 for browser playback.
        Uses bundled ffmpeg from imageio-ffmpeg, or system ffmpeg as fallback.
        """
        # Use bundled ffmpeg first (works in .exe), then system ffmpeg
        ffmpeg = FFMPEG_PATH or shutil.which("ffmpeg")
        if not ffmpeg:
            print("[ScreenRecorder] ⚠️ ffmpeg not found - video may not play in browser")
            return path

        h264_path = path.with_name(f"{path.stem}_h264.mp4")
        cmd = [
            ffmpeg,
            "-y",
            "-loglevel", "warning",
            "-i", str(path),
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "26",  # slightly better quality than before (28)
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-an",  # No audio
            str(h264_path),
        ]

        try:
            print("[ScreenRecorder] Transcoding to H.264 for browser playback...")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0 and h264_path.exists():
                h264_size = h264_path.stat().st_size / (1024 * 1024)
                orig_size = path.stat().st_size / (1024 * 1024)
                print(
                    f"[ScreenRecorder] ✓ H.264 transcode success: {h264_size:.2f} MB "
                    f"(was {orig_size:.2f} MB)"
                )
                # Delete original mp4v file to save space
                try:
                    path.unlink()
                except Exception:
                    pass
                return h264_path
            else:
                stderr = result.stderr[:200] if result.stderr else "unknown error"
                print(f"[ScreenRecorder] H.264 transcode failed: {stderr}")
        except subprocess.TimeoutExpired:
            print("[ScreenRecorder] H.264 transcode timed out")
        except Exception as exc:
            print(f"[ScreenRecorder] H.264 transcode error: {exc}")
        return path

    try:
        start_time = time.time()
        frame_count = 0
        dropped_frames = 0
        
        print(
            f"[ScreenRecorder] Starting recording: "
            f"{duration_seconds}s, {width}x{height} -> {target_w}x{target_h} @ {fps}fps"
        )
        
        with mss.mss() as sct:
            # Use the same monitor index selected earlier (default: 0 = all monitors)
            monitor = sct.monitors[selected_index]
            
            while time.time() - start_time < duration_seconds:
                frame_start = time.time()
                
                # Capture screen
                screenshot = sct.grab(monitor)
                
                # Convert to numpy array and then to BGR for OpenCV
                img = np.array(screenshot)
                img_bgr = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

                # Resize if downscaling (use INTER_LINEAR for speed)
                if (width, height) != target_size:
                    img_bgr = cv2.resize(img_bgr, target_size, interpolation=cv2.INTER_LINEAR)
                
                # Write frame
                video_writer.write(img_bgr)
                frame_count += 1
                
                # Maintain frame rate - skip sleep if we're behind
                elapsed = time.time() - frame_start
                sleep_time = frame_time - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)
                elif elapsed > frame_time * 2:
                    # We're way behind, note it but continue
                    dropped_frames += 1
        
        video_writer.release()
        
        # Verify file was created
        if not output_path.exists():
            raise RuntimeError("Video file was not created")
        
        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        drop_msg = f" ({dropped_frames} slow frames)" if dropped_frames else ""
        print(f"[ScreenRecorder] Recording complete: {frame_count} frames, {file_size_mb:.2f} MB{drop_msg}")
        
        # Transcode to H.264 for browser playback
        final_path = _transcode_to_h264(output_path)

        return str(final_path)
    
    except Exception as e:
        # Clean up on error
        video_writer.release()
        if output_path.exists():
            try:
                output_path.unlink()
            except Exception:
                pass
        raise RuntimeError(f"Recording failed: {e}") from e


def upload_video(video_path: str, device_id: str, command_id: str, dashboard_url: str, token: Optional[str] = None) -> bool:
    """
    Upload video file to dashboard API endpoint.
    
    Args:
        video_path: Path to video file
        device_id: Device identifier
        command_id: Command ID for tracking
        dashboard_url: Base URL of dashboard API (e.g., "https://dashboard.com/api")
        token: Optional authentication token
    
    Returns:
        True if upload successful, False otherwise
    """
    try:
        import requests
        
        upload_url = f"{dashboard_url.rstrip('/')}/recordings/upload"
        
        if not os.path.exists(video_path):
            print(f"[ScreenRecorder] Video file not found: {video_path}")
            return False
        
        file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
        print(f"[ScreenRecorder] Uploading video: {file_size_mb:.2f} MB")
        
        upload_ok = False
        with open(video_path, 'rb') as video_file:
            files = {
                'file': (os.path.basename(video_path), video_file, 'video/mp4')
            }
            data = {
                'deviceId': device_id,
                'commandId': command_id
            }
            headers = {}
            if token:
                headers['Authorization'] = f'Bearer {token}'
            
            response = requests.post(
                upload_url,
                files=files,
                data=data,
                headers=headers,
                timeout=300  # 5 minute timeout for large files
            )
            
            response.raise_for_status()
            
            result = response.json()
            if result.get('ok'):
                upload_ok = True
                recording_id = result.get('data', {}).get('recordingId')
                print(f"[ScreenRecorder] Upload successful: recordingId={recording_id}")
            else:
                error_msg = result.get('error', 'Unknown error')
                print(f"[ScreenRecorder] Upload failed: {error_msg}")
                return False
        
        # Clean up local file after the file handle is closed
        if upload_ok:
            try:
                os.remove(video_path)
                print(f"[ScreenRecorder] Local file cleaned up: {video_path}")
            except Exception as e:
                print(f"[ScreenRecorder] Warning: Failed to clean up local file: {e}")
            return True
    
    except requests.exceptions.RequestException as e:
        print(f"[ScreenRecorder] Upload error: {e}")
        return False
    except Exception as e:
        print(f"[ScreenRecorder] Unexpected upload error: {e}")
        return False