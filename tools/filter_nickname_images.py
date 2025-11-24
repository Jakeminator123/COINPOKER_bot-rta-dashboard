#!/usr/bin/env python3
"""
Filter nickname debug images to keep only red/pink and white pixels.
All other pixels become black.
"""

import sys
from pathlib import Path
import numpy as np
from PIL import Image

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def filter_red_pink_white(image: Image.Image, red_tolerance: int = 50, white_threshold: int = 200) -> Image.Image:
    """
    Filter image to keep only red/pink and white pixels.
    All other pixels become black.
    
    Args:
        image: PIL Image to filter
        red_tolerance: Tolerance for red/pink detection (higher = more lenient)
        white_threshold: Minimum RGB value for white detection (0-255)
    
    Returns:
        Filtered PIL Image (black background, white/red pixels preserved)
    """
    try:
        img_array = np.array(image)
        if img_array.ndim != 3 or img_array.shape[2] not in (3, 4):
            image = image.convert("RGB")
            img_array = np.array(image)

        channels = img_array.shape[2]
        has_alpha = channels == 4

        # Always base color checks on RGB channels
        r = img_array[:, :, 0]
        g = img_array[:, :, 1]
        b = img_array[:, :, 2]
        
        # Red/pink mask: red channel is dominant
        red_mask = (
            (r > 120) &  # Red channel is bright
            (r > g) &    # Red > Green
            (r > b) &    # Red > Blue
            ((r > g + red_tolerance) | (r > b + red_tolerance))  # Significant red dominance
        )
        
        # Pink mask: similar to red but more balanced (pink is red + white)
        pink_mask = (
            (r > 150) &  # Red channel is bright
            (g > 100) &  # Green is present (makes it pink)
            (b > 100) &  # Blue is present
            (r > g) &    # Red still dominant
            (r > b) &
            ((r - g) < 80) &  # Not too red (pink is more balanced)
            ((r - b) < 80)
        )
        
        # White mask: all channels are high
        white_mask = (
            (r >= white_threshold) &
            (g >= white_threshold) &
            (b >= white_threshold)
        )
        
        # Combine masks: red OR pink OR white
        combined_mask = red_mask | pink_mask | white_mask
        
        # Create filtered image: white where mask is true, black elsewhere
        white_value = [255, 255, 255] + ([255] if has_alpha else [])
        black_value = [0, 0, 0] + ([0] if has_alpha else [])

        filtered = np.zeros_like(img_array)
        filtered[combined_mask] = white_value  # White for matching pixels
        filtered[~combined_mask] = black_value       # Black for everything else
        
        filtered_img = Image.fromarray(filtered.astype(np.uint8))
        return filtered_img
        
    except Exception as e:
        print(f"Error filtering image: {e}")
        return image


def process_nickname_debug_images():
    """Process all PNG images in nickname_debug folder."""
    project_root = Path(__file__).parent.parent
    debug_dir = project_root / "nickname_debug"
    
    if not debug_dir.exists():
        print(f"Error: {debug_dir} does not exist")
        return
    
    # Find all PNG files
    png_files = list(debug_dir.glob("*.png"))
    
    if not png_files:
        print(f"No PNG files found in {debug_dir}")
        return
    
    print(f"Found {len(png_files)} PNG file(s) to process...")
    
    for png_file in png_files:
        try:
            # Skip already filtered images
            if "_filtered" in png_file.stem:
                print(f"Skipping already filtered: {png_file.name}")
                continue
            
            print(f"Processing: {png_file.name}")
            
            # Load image
            img = Image.open(png_file)
            
            # Filter image
            filtered_img = filter_red_pink_white(img)
            
            # Save filtered version
            output_name = png_file.stem + "_filtered.png"
            output_path = debug_dir / output_name
            filtered_img.save(output_path)
            
            print(f"  [OK] Saved: {output_name}")
            
        except Exception as e:
            print(f"  [ERROR] Error processing {png_file.name}: {e}")
    
    print("\nDone!")


if __name__ == "__main__":
    process_nickname_debug_images()

