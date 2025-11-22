"use client";

import { useEffect, useRef, useState, useMemo } from "react";

// TypeScript declarations for Google Maps
declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (element: HTMLElement, options?: any) => any;
        Marker: new (options?: any) => any;
        Animation: {
          DROP: any;
        };
      };
    };
  }
}

interface IPLocationMapProps {
  ipAddress: string;
}

/**
 * Google Maps component that displays a map based on IP address location
 * Uses lazy loading to only load when component is visible
 */
export default function IPLocationMap({ ipAddress }: IPLocationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; address?: string; isPrivateIP?: boolean } | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [testIp, setTestIp] = useState<string>("");
  const [manualIp, setManualIp] = useState<string>("");
  const effectiveIp = useMemo(() => (testIp?.trim() || ipAddress), [testIp, ipAddress]);
  const isUnmountedRef = useRef(false);

  // Safe, singleton Google Maps script loader
  const loadGoogleMapsScript = useMemo(() => {
    let loaderPromise: Promise<void> | null = null;
    return (apiKey: string) => {
      if (window.google?.maps) return Promise.resolve();
      if (loaderPromise) return loaderPromise;

      loaderPromise = new Promise<void>((resolve, reject) => {
        const existing = document.getElementById("google-maps-script") as HTMLScriptElement | null;
        if (existing && existing.getAttribute("data-loaded") === "true") {
          resolve();
          return;
        }
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps")));
          return;
        }
        const script = document.createElement("script");
        script.id = "google-maps-script";
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          script.setAttribute("data-loaded", "true");
          // Suppress billing errors in console (they're handled by UI)
          const originalError = console.error;
          const suppressedErrors = ['BillingNotEnabledMapError', 'billing-not-enabled'];
          const errorInterceptor = (...args: any[]) => {
            const errorStr = args.join(' ');
            if (suppressedErrors.some(err => errorStr.includes(err))) {
              // Silently ignore billing errors - they're handled by UI detection
              return;
            }
            originalError.apply(console, args);
          };
          // Only override if not already overridden
          if (console.error === originalError) {
            console.error = errorInterceptor;
          }
          resolve();
        };
        script.onerror = () => reject(new Error("Failed to load Google Maps"));
        document.head.appendChild(script);
      });

      return loaderPromise;
    };
  }, []);

  // Helper function to check if IP is private/localhost
  const isPrivateIP = (ip: string): boolean => {
    if (!ip) return true;
    // Localhost
    if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
    // Private IP ranges
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") || 
        ip.startsWith("172.19.") || ip.startsWith("172.20.") || ip.startsWith("172.21.") ||
        ip.startsWith("172.22.") || ip.startsWith("172.23.") || ip.startsWith("172.24.") ||
        ip.startsWith("172.25.") || ip.startsWith("172.26.") || ip.startsWith("172.27.") ||
        ip.startsWith("172.28.") || ip.startsWith("172.29.") || ip.startsWith("172.30.") ||
        ip.startsWith("172.31.")) return true;
    return false;
  };

  // Fetch API key from server
  useEffect(() => {
    const fetchApiKey = async () => {
      try {
        const response = await fetch("/api/google-maps-key");
        if (response.ok) {
          const data = await response.json();
          setApiKey(data.apiKey);
        } else {
          setError("Google Maps API key not configured");
        }
      } catch (err) {
        console.error("Error fetching API key:", err);
        setError("Failed to load Google Maps API key");
      }
    };

    fetchApiKey();
  }, []);

  // Lazy load: Only load when component is visible
  useEffect(() => {
    if (!effectiveIp || !apiKey || isLoaded || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsLoading(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (mapRef.current) {
      observer.observe(mapRef.current);
    }

    return () => observer.disconnect();
  }, [effectiveIp, apiKey, isLoaded, isLoading]);

  // Load Google Maps script and geocode IP
  useEffect(() => {
    if (!isLoading || isLoaded || !apiKey) return;

    const loadMap = async () => {
      try {
        const isPrivate = isPrivateIP(effectiveIp);
        console.log(`[IPLocationMap] Attempting to geolocate IP: ${effectiveIp} (Private: ${isPrivate})`);
        
        // Load Google Maps JavaScript API
        if (!apiKey) {
          throw new Error("Google Maps API key not available");
        }
        await loadGoogleMapsScript(apiKey);

        // Geocode IP address to get coordinates
        // Try multiple IP geolocation services as fallback
        let geoData: any = null;
        let lat: number | null = null;
        let lng: number | null = null;
        let address: string | undefined = undefined;
        let lastError: string | null = null;

        // Try ipapi.co first
        try {
          console.log(`[IPLocationMap] Trying ipapi.co for ${effectiveIp}`);
          const geoResponse = await fetch(`https://ipapi.co/${effectiveIp}/json/`, {
            headers: {
              'Accept': 'application/json',
            },
          });
          
          if (geoResponse.ok) {
            geoData = await geoResponse.json();
            console.log(`[IPLocationMap] ipapi.co response:`, geoData);
            
            if (geoData.error) {
              lastError = geoData.reason || geoData.error || "ipapi.co returned an error";
              console.warn(`[IPLocationMap] ipapi.co error:`, geoData);
            } else if (geoData.latitude && geoData.longitude) {
              lat = parseFloat(geoData.latitude);
              lng = parseFloat(geoData.longitude);
              if (!isNaN(lat) && !isNaN(lng)) {
                address = geoData.city
                  ? `${geoData.city}, ${geoData.region || ""} ${geoData.country_name || ""}`.trim()
                  : undefined;
                console.log(`[IPLocationMap] Successfully got location from ipapi.co: ${lat}, ${lng}`);
              }
            }
          } else {
            lastError = `ipapi.co returned status ${geoResponse.status}`;
            console.warn(`[IPLocationMap] ipapi.co failed with status:`, geoResponse.status);
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : "Network error";
          console.warn("[IPLocationMap] ipapi.co failed, trying fallback:", err);
        }

        // Fallback to ip-api.com if first service failed
        if (!lat || !lng) {
          try {
            console.log(`[IPLocationMap] Trying ip-api.com for ${effectiveIp}`);
            const fallbackResponse = await fetch(`https://ip-api.com/json/${effectiveIp}`, {
              headers: {
                'Accept': 'application/json',
              },
            });
            
            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json();
              console.log(`[IPLocationMap] ip-api.com response:`, fallbackData);
              
              if (fallbackData.status === 'success' && fallbackData.lat && fallbackData.lon) {
                lat = parseFloat(fallbackData.lat);
                lng = parseFloat(fallbackData.lon);
                if (!isNaN(lat) && !isNaN(lng)) {
                  address = fallbackData.city
                    ? `${fallbackData.city}, ${fallbackData.regionName || ""} ${fallbackData.country || ""}`.trim()
                    : undefined;
                  console.log(`[IPLocationMap] Successfully got location from ip-api.com: ${lat}, ${lng}`);
                }
              } else {
                lastError = fallbackData.message || "ip-api.com returned unsuccessful status";
                console.warn(`[IPLocationMap] ip-api.com failed:`, fallbackData);
              }
            } else {
              lastError = `ip-api.com returned status ${fallbackResponse.status}`;
              console.warn(`[IPLocationMap] ip-api.com failed with status:`, fallbackResponse.status);
            }
          } catch (err) {
            lastError = err instanceof Error ? err.message : "Network error";
            console.warn("[IPLocationMap] Fallback IP service also failed:", err);
          }
        }

        // If we still don't have coordinates, try browser geolocation as fallback for private IPs
        if ((!lat || !lng || isNaN(lat) || isNaN(lng)) && isPrivate) {
          try {
            console.log(`[IPLocationMap] Trying browser geolocation as fallback for private IP`);
            const browserLocation = await new Promise<GeolocationPosition>((resolve, reject) => {
              if (!navigator.geolocation) {
                reject(new Error("Browser geolocation not available"));
                return;
              }
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
            });
            
            lat = browserLocation.coords.latitude;
            lng = browserLocation.coords.longitude;
            address = "Approximate location (browser geolocation)";
            console.log(`[IPLocationMap] Got location from browser geolocation: ${lat}, ${lng}`);
          } catch (err) {
            console.warn("[IPLocationMap] Browser geolocation also failed:", err);
          }
        }

        // If we still don't have coordinates, use a default location (center of Sweden) for private IPs
        if ((!lat || !lng || isNaN(lat) || isNaN(lng)) && isPrivate) {
          console.log(`[IPLocationMap] Using default location for private IP`);
          lat = 59.3293; // Stockholm, Sweden
          lng = 18.0686;
          address = "Approximate location (default)";
        }

        // If we still don't have coordinates, throw error
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
          const errorMsg = lastError 
            ? `Unable to determine location for IP ${effectiveIp}. ${lastError}`
            : `Unable to determine location for IP ${effectiveIp}. The IP may be invalid or the geolocation services are unavailable.`;
          throw new Error(errorMsg);
        }

        if (!isUnmountedRef.current) {
          setLocation({
            lat,
            lng,
            address,
            isPrivateIP: isPrivate, // Store if it's a private IP for warning display
          });
        }

        // Initialize map
        if (mapRef.current && window.google?.maps && !isUnmountedRef.current) {
          // If a map already exists, just update center/marker; otherwise, create new
          if (mapInstanceRef.current) {
            try {
              mapInstanceRef.current.setCenter({ lat, lng });
              if (markerRef.current) {
                markerRef.current.setPosition({ lat, lng });
                markerRef.current.setTitle(address || effectiveIp);
              } else {
                markerRef.current = new window.google.maps.Marker({
                  position: { lat, lng },
                  map: mapInstanceRef.current,
                  title: address || effectiveIp,
                  animation: window.google.maps.Animation.DROP,
                });
              }
            } catch (e) {
              console.warn("[IPLocationMap] Failed to update existing map, recreating...", e);
              mapInstanceRef.current = null;
              markerRef.current = null;
            }
          }

          if (!mapInstanceRef.current) {
            const map = new window.google.maps.Map(mapRef.current, {
              center: { lat, lng },
              zoom: 10,
              styles: [
                {
                  featureType: "all",
                  elementType: "geometry",
                  stylers: [{ color: "#1e293b" }], // slate-800
                },
                {
                  featureType: "all",
                  elementType: "labels.text.fill",
                  stylers: [{ color: "#cbd5e1" }], // slate-300
                },
                {
                  featureType: "water",
                  elementType: "geometry",
                  stylers: [{ color: "#0f172a" }], // slate-900
                },
                {
                  featureType: "road",
                  elementType: "geometry",
                  stylers: [{ color: "#334155" }], // slate-700
                },
              ],
              disableDefaultUI: false,
              zoomControl: true,
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: true,
            });

            // Detect Google Maps errors (like "This page can't load Google Maps correctly")
            // Also check if map actually loaded successfully despite any warnings
            const errorCheckTimeout = setTimeout(() => {
              if (mapRef.current && !isUnmountedRef.current) {
                const errorContainer = mapRef.current.querySelector('.gm-err-container');
                const errorMessage = mapRef.current.querySelector('.gm-err-message');
                
                // Check if map tiles are actually visible (map is working)
                const mapTiles = mapRef.current.querySelectorAll('img[src*="maps.googleapis.com"]');
                const hasVisibleTiles = mapTiles.length > 0;
                
                // Only show error if there's an error container AND no visible tiles
                if ((errorContainer || errorMessage) && !hasVisibleTiles) {
                  setError("Google Maps API key is not properly configured. Please check API key restrictions and billing settings in Google Cloud Console.");
                  setIsLoading(false);
                } else if (hasVisibleTiles && !isUnmountedRef.current) {
                  // Map is working, clear any errors
                  setError(null);
                  setIsLoaded(true);
                  setIsLoading(false);
                }
              }
            }, 3000); // Check after 3 seconds to allow map to load

            // Store timeout ID for cleanup
            (map as any)._errorCheckTimeout = errorCheckTimeout;

            // Add marker
            const marker = new window.google.maps.Marker({
              position: { lat, lng },
              map,
              title: address || effectiveIp,
              animation: window.google.maps.Animation.DROP,
            });

            mapInstanceRef.current = map;
            markerRef.current = marker;
          }

          if (!isUnmountedRef.current) {
            setIsLoaded(true);
            setIsLoading(false);
            setError(null);
          }
        }
      } catch (err) {
        if (!isUnmountedRef.current) {
          console.error("Error loading map:", err);
          setError(err instanceof Error ? err.message : "Failed to load map");
          setIsLoading(false);
        }
      }
    };

    loadMap();
  }, [isLoading, isLoaded, effectiveIp, apiKey, loadGoogleMapsScript]);

  // Reset state when IP changes
  useEffect(() => {
    setIsLoaded(false);
    setIsLoading(false);
    setError(null);
    setLocation(null);
  }, [effectiveIp]);

  // Cleanup on unmount to avoid DOM detach issues
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      try {
        // Clear timeout if map has one
        if (mapInstanceRef.current && (mapInstanceRef.current as any)._errorCheckTimeout) {
          clearTimeout((mapInstanceRef.current as any)._errorCheckTimeout);
        }
        if (markerRef.current) {
          markerRef.current.setMap(null);
          markerRef.current = null;
        }
        // Do not remove the map container or script tag; just null references
        mapInstanceRef.current = null;
      } catch {
        // Ignore cleanup errors - component is unmounting
      }
    };
  }, []);

  if (!ipAddress) {
    return (
      <div
        className="glass-card p-4 sm:p-6 animate-slide-up mt-4"
        style={{ animationDelay: "150ms" }}
      >
        <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">
          📍 Location
        </h3>
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 text-sm text-slate-400">
          <p className="font-semibold text-slate-200 mb-2">
            No network data available
          </p>
          <p className="text-xs text-slate-500">
            IP address is missing for this player. Map preview is unavailable.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 sm:p-6 animate-slide-up mt-4" style={{ animationDelay: "150ms" }}>
      <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">
        📍 Location
      </h3>

      {/* Map container with overlay spinner (no React children inside the map div) */}
      <div className="relative">
        <div
          ref={mapRef}
          className="w-full h-64 rounded-lg overflow-hidden border border-slate-700/50 bg-slate-800/50"
          style={{ minHeight: "256px" }}
        />
        {/* Purple tint overlay to blend with UI - positioned above map but below loading spinner */}
        <div 
          className="absolute inset-0 pointer-events-none rounded-lg z-10"
          style={{
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(99, 102, 241, 0.15) 50%, rgba(139, 92, 246, 0.05) 100%)',
            mixBlendMode: 'overlay'
          }}
        />
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto mb-2"></div>
              <p className="text-sm text-slate-400">Loading map...</p>
            </div>
          </div>
        )}
      </div>

      {/* Error message (shown below the map to avoid tearing the map container) */}
      {error && (
        <div className="text-sm text-red-400 py-3">
          <div className="font-medium mb-1">Unable to load map</div>
          <div className="text-xs text-red-300/80">{error}</div>
          {error.includes("API key") && (
            <div className="text-xs text-slate-400 mt-2 space-y-1">
              <div>To fix this:</div>
              <div>1. Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Cloud Console</a></div>
              <div>2. Select your API key</div>
              <div>3. Under &quot;Application restrictions&quot;, add HTTP referrers:</div>
              <div className="ml-4 font-mono text-xs">• http://localhost:3001/*</div>
              <div className="ml-4 font-mono text-xs">• https://your-domain.com/*</div>
              <div>4. Enable billing for your project</div>
              <div>5. Enable &quot;Maps JavaScript API&quot; in API Library</div>
            </div>
          )}
          {effectiveIp && (
            <div className="text-xs text-slate-500 mt-2">
              IP Address: <span className="font-mono">{effectiveIp}</span>
            </div>
          )}
        </div>
      )}
      
      {/* IP + location hint */}
      {location?.address && (
        <div className="mt-3 text-xs text-slate-400">
          <span className="font-medium text-slate-300">IP:</span> {effectiveIp} • {location.address}
          {location.isPrivateIP && (
            <span className="ml-2 text-yellow-400">(Private IP - approximate location)</span>
          )}
        </div>
      )}
      {location && !location.address && (
        <div className="mt-3 text-xs text-slate-400">
          <span className="font-medium text-slate-300">IP:</span> {effectiveIp}
          {location.isPrivateIP && (
            <span className="ml-2 text-yellow-400">(Private IP - approximate location)</span>
          )}
        </div>
      )}

      {(isPrivateIP(effectiveIp) || error) && (
        <div className="mt-3 p-3 border border-slate-700/50 rounded-lg bg-slate-800/40">
          <div className="text-xs text-slate-400 mb-2">
            Test geolocation:
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={async () => {
                try {
                  const res = await fetch("https://api64.ipify.org?format=json");
                  const data = await res.json();
                  if (data?.ip) setTestIp(data.ip);
                } catch {
                  // Ignore IP fetch errors - not critical
                }
              }}
              className="px-3 py-1.5 text-xs rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 transition"
            >
              Use my IP
            </button>
            <div className="flex-1 flex items-center gap-2">
              <input
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                placeholder="Enter public IP (e.g. 85.228.x.x)"
                className="flex-1 px-3 py-1.5 text-xs rounded-md bg-slate-900/60 border border-slate-700/60 text-slate-200 placeholder-slate-500"
              />
              <button
                onClick={() => setTestIp((manualIp || "").trim())}
                className="px-3 py-1.5 text-xs rounded-md bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/50 text-slate-200 transition"
              >
                Apply
              </button>
              <button
                onClick={() => { setTestIp(""); setManualIp(""); }}
                className="px-3 py-1.5 text-xs rounded-md bg-slate-700/20 hover:bg-slate-700/40 border border-slate-600/40 text-slate-300 transition"
              >
                Reset
              </button>
            </div>
          </div>
          {testIp && (
            <div className="mt-2 text-[11px] text-slate-500">
              Using override IP: <span className="font-mono text-slate-300">{testIp}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

