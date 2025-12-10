"""
Screen Recorder Utility
=======================
Records screen capture for specified duration and saves as MP4 video file.
Uses mss for screen capture and opencv-python for video encoding.
"""

import os
import sys
import time
import tempfile
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


def record_screen(duration_seconds: int, output_path: Optional[str] = None) -> str:
    """
    Record full screen for specified duration and save as MP4 video.
    
    Args:
        duration_seconds: Duration to record in seconds (min 1, max 600)
        output_path: Optional path to save video. If None, uses temp directory.
    
    Returns:
        Path to saved video file
    
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
    
    # Screen capture settings
    fps = 30
    frame_time = 1.0 / fps
    
    # Get screen dimensions
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # Primary monitor (index 1 is full screen)
        width = monitor["width"]
        height = monitor["height"]
    
    # Video codec and writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    video_writer = cv2.VideoWriter(
        str(output_path),
        fourcc,
        fps,
        (width, height)
    )
    
    if not video_writer.isOpened():
        raise RuntimeError("Failed to initialize video writer")
    
    try:
        start_time = time.time()
        frame_count = 0
        
        print(f"[ScreenRecorder] Starting recording: {duration_seconds}s, {width}x{height} @ {fps}fps")
        
        with mss.mss() as sct:
            monitor = sct.monitors[1]
            
            while time.time() - start_time < duration_seconds:
                frame_start = time.time()
                
                # Capture screen
                screenshot = sct.grab(monitor)
                
                # Convert to numpy array and then to BGR for OpenCV
                img = np.array(screenshot)
                img_bgr = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
                
                # Write frame
                video_writer.write(img_bgr)
                frame_count += 1
                
                # Maintain frame rate
                elapsed = time.time() - frame_start
                sleep_time = frame_time - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)
        
        video_writer.release()
        
        # Verify file was created
        if not output_path.exists():
            raise RuntimeError("Video file was not created")
        
        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"[ScreenRecorder] Recording complete: {frame_count} frames, {file_size_mb:.2f} MB")
        
        return str(output_path)
    
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
