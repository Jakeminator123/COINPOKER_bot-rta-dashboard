"""
Network Information Utilities
=============================
Provides functions for getting public IP and geolocation information.
"""

from typing import Any, Dict


def get_public_ip_info(timeout: float = 5.0) -> Dict[str, Any]:
    """Retrieve public IP and geolocation metadata."""
    info: Dict[str, Any] = {
        "ip": None,
        "city": None,
        "region": None,
        "country": None,
        "latitude": None,
        "longitude": None,
        "error": None,
    }
    errors: list[str] = []

    try:
        import requests
        
        # Get public IP
        try:
            response = requests.get(
                "https://api.ipify.org",
                params={"format": "json"},
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json() or {}
            info["ip"] = data.get("ip")
            if not info["ip"]:
                errors.append("IP service did not return an address")
        except Exception as exc:
            errors.append(f"IP lookup failed: {exc}")

        # Get geolocation if we have an IP
        if info["ip"]:
            try:
                geo_response = requests.get(
                    f"https://ipapi.co/{info['ip']}/json/",
                    timeout=timeout,
                )
                geo_response.raise_for_status()
                geo_data = geo_response.json() or {}
                info["city"] = geo_data.get("city")
                info["region"] = geo_data.get("region")
                info["country"] = geo_data.get("country_name") or geo_data.get("country")
                info["latitude"] = geo_data.get("latitude")
                info["longitude"] = geo_data.get("longitude")
            except Exception as exc:
                errors.append(f"Geo lookup failed: {exc}")
    except ImportError:
        errors.append("requests module not available")

    if errors:
        info["error"] = "; ".join(errors)
    
    return info


def format_public_ip_log(info: Dict[str, Any]) -> str:
    """Format public IP info for logging."""
    ip_addr = info.get("ip")
    if ip_addr:
        parts = [info.get("city"), info.get("region"), info.get("country")]
        location = ", ".join([part for part in parts if part])
        location = location or "Location unavailable"

        lat = info.get("latitude")
        lon = info.get("longitude")
        coords = ""
        if lat not in (None, "") and lon not in (None, ""):
            coords = f" (lat {lat}, lon {lon})"

        return f"Public IP: {ip_addr} - {location}{coords}"
    else:
        error_msg = info.get("error") or "Lookup unavailable"
        return f"Public IP lookup failed: {error_msg}"