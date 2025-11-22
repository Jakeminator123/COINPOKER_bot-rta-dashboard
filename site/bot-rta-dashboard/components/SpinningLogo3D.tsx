'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface SpinningLogo3DProps {
  src?: string;
  width?: number;
  height?: number;
  className?: string;
  rotationSpeed?: number;
}

/**
 * SpinningLogo3D Component
 * 
 * Renders a 3D spinning logo using Three.js loaded from CDN.
 * Uses the same approach as the vanilla viewer - no build tools required.
 * 
 * @param src - Path to the GLB model file (default: '/coin_logo.glb')
 * @param width - Width of the canvas (default: 80)
 * @param height - Height of the canvas (default: 80)
 * @param className - Additional CSS classes
 * @param rotationSpeed - Rotation speed multiplier (default: 1.0)
 */
export default function SpinningLogo3D({ 
  src = '/coin_logo.glb', 
  width = 80, 
  height = 80,
  className = '',
  rotationSpeed = 1.0
}: SpinningLogo3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const animationIdRef = useRef<number | null>(null);
  const clockRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const isInitializedRef = useRef(false);
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);

  // Use Intersection Observer to only render when visible (prevents WebGL context exhaustion)
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      {
        rootMargin: '50px', // Start loading slightly before entering viewport
        threshold: 0.01,
      }
    );

    observer.observe(containerRef.current);
    intersectionObserverRef.current = observer;

    return () => {
      if (intersectionObserverRef.current) {
        intersectionObserverRef.current.disconnect();
        intersectionObserverRef.current = null;
      }
    };
  }, []);

  // Cleanup when component becomes invisible
  useEffect(() => {
    if (!isVisible && isInitializedRef.current) {
      // Component became invisible, cleanup WebGL resources
      const cleanup = () => {
        if (animationIdRef.current !== null) {
          cancelAnimationFrame(animationIdRef.current);
          animationIdRef.current = null;
        }
        
        if (rendererRef.current) {
          try {
            if (rendererRef.current.forceContextLoss) {
              rendererRef.current.forceContextLoss();
            }
            if (rendererRef.current.dispose) {
              rendererRef.current.dispose();
            }
            if (rendererRef.current.domElement && rendererRef.current.domElement.parentNode) {
              rendererRef.current.domElement.remove();
            }
          } catch (e) {
            // Silently ignore cleanup errors
          }
          rendererRef.current = null;
        }
        
        if (modelRef.current && modelRef.current.traverse) {
          try {
            modelRef.current.traverse((child: any) => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((mat: any) => {
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                  });
                } else {
                  if (child.material.map) child.material.map.dispose();
                  child.material.dispose();
                }
              }
            });
          } catch (e) {
            // Silently ignore cleanup errors
          }
          modelRef.current = null;
        }
        
        sceneRef.current = null;
        cameraRef.current = null;
        isInitializedRef.current = false;
      };
      
      cleanup();
    }
  }, [isVisible]);

  useEffect(() => {
    // Prevent double initialization or render when not visible
    if (isInitializedRef.current || !containerRef.current || !isVisible) return;
    
    isInitializedRef.current = true;
    setIsLoading(true);
    setError(null);

    let renderer: any;
    let scene: any;
    let camera: any;
    let model: any;
    let animationId: number | null = null;
    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
        animationIdRef.current = null;
      }
      
      // Don't manually remove DOM nodes - let React handle DOM cleanup
      // Only dispose Three.js resources
      if (renderer) {
        try {
          // Remove event listeners and dispose renderer
          if (renderer.dispose) {
            renderer.dispose();
          }
          // Force WebGL context loss to free up resources (not all browsers expose WEBGL_lose_context)
          if (renderer.forceContextLoss) {
            renderer.forceContextLoss();
          }
          // Clear the canvas
          if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.remove();
          }
        } catch (e) {
          // Silently ignore cleanup errors
        }
        rendererRef.current = null;
      }
      
      if (model && model.traverse) {
        try {
          model.traverse((child: any) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((mat: any) => {
                  if (mat.map) mat.map.dispose();
                  mat.dispose();
                });
              } else {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
              }
            }
          });
        } catch (e) {
          // Silently ignore cleanup errors
        }
        modelRef.current = null;
      }
      
      sceneRef.current = null;
      cameraRef.current = null;
    };

    // Load Three.js - now using installed package
    const loadThreeJS = async (): Promise<boolean> => {
      // Three.js is already imported, so we can use it directly
      return true;
    };

    // Initialize Three.js scene
    const initScene = () => {
      if (!containerRef.current) return false;

      try {
        // Ensure container is empty (avoid duplicate canvases after HMR/re-mount)
        // Remove any existing canvas elements before adding new one
        if (containerRef.current) {
          const existingCanvas = containerRef.current.querySelector('canvas');
          if (existingCanvas && existingCanvas.parentNode === containerRef.current) {
            try {
              existingCanvas.remove();
            } catch (e) {
              // Silently ignore
            }
          }
        }

        // Create renderer
        renderer = new THREE.WebGLRenderer({ 
          antialias: true, 
          alpha: true,
          powerPreference: 'high-performance'
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
        
        // Ensure canvas is visible and positioned correctly
        const canvas = renderer.domElement;
        canvas.style.display = 'block';
        canvas.style.position = 'relative';
        canvas.style.zIndex = '1';
        canvas.style.pointerEvents = 'none'; // Don't interfere with clicks
        
        containerRef.current.appendChild(canvas);
        rendererRef.current = renderer;

        // Create scene
        scene = new THREE.Scene();
        scene.background = null; // Transparent background
        sceneRef.current = scene;

        // Create camera
        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        
        // Dynamic camera zoom based on size - smaller sizes need camera closer to fill space
        // But not too close or model will be outside view
        let cameraDistance;
        if (width <= 40) {
          // Very small sizes: camera closer but not too close
          cameraDistance = 1.5; // Close enough to make model appear larger
        } else if (width <= 80) {
          // Small-medium sizes
          cameraDistance = 2.0;
        } else if (width <= 120) {
          // Medium sizes
          cameraDistance = 2.5;
        } else {
          // Larger sizes: normal distance
          cameraDistance = 3;
        }
        
        camera.position.set(0, 0.1, cameraDistance);
        cameraRef.current = camera;

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const dir1 = new THREE.DirectionalLight(0xffffff, 1);
        dir1.position.set(4, 5, 6);
        scene.add(dir1);

        const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
        dir2.position.set(-4, -1, -2);
        scene.add(dir2);

        // Load model
        const loader = new GLTFLoader();
        loader.load(
          src,
          (gltf: any) => {
            model = gltf.scene;
            // Center model around origin
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.sub(center);

            // Scale model based on canvas size - smaller sizes need larger scale to fill space
            const target = Math.max(width, height);
            let scaleFactor;
            
            // For small sizes, make model much larger to fill the small canvas
            if (width <= 40) {
              // Very small sizes: make model much larger to fill space
              scaleFactor = 6.0; // Even larger scale to make it more prominent
            } else if (width <= 80) {
              // Small-medium sizes
              scaleFactor = 4.0;
            } else if (width <= 120) {
              // Medium sizes
              scaleFactor = 3.0;
            } else {
              // Larger sizes: normal scaling
              scaleFactor = Math.min(3.0, Math.max(1.0, target / 200));
            }
            model.scale.setScalar(scaleFactor);

            // Vertical offset - adjust positioning
            // Positive Y moves up, negative moves down
            if (width <= 40) {
              model.position.y += 0.15; // Move up slightly for small sizes
            } else {
              model.position.y += 0.05; // Slight upward adjustment
            }

            scene.add(model);
            modelRef.current = model;

            // Initialize clock for smooth time-based animation
            if (!clockRef.current) {
              clockRef.current = new THREE.Clock();
              clockRef.current.start();
            } else {
              clockRef.current.start();
            }
            setIsLoading(false);
            
            // Start animation - ensure it runs
            if (renderer && scene && camera) {
              animate();
            }
          },
          (_progress: any) => {
            // Loading progress callback (optional)
            // _progress.loaded / _progress.total gives percentage if needed
          },
          (err: any) => {
            console.error('Failed to load 3D model:', err);
            setError('Failed to load 3D model');
            setIsLoading(false);
          }
        );

        return true;
      } catch (err) {
        console.error('Failed to initialize scene:', err);
        setError('Failed to initialize 3D scene');
        setIsLoading(false);
        return false;
      }
    };

    // Animation loop
    const animate = () => {
      // Use refs to access current values
      const currentRenderer = rendererRef.current;
      const currentScene = sceneRef.current;
      const currentCamera = cameraRef.current;
      
      if (!currentRenderer || !currentScene || !currentCamera) {
        return;
      }
      
      animationId = requestAnimationFrame(animate);
      animationIdRef.current = animationId;

      if (modelRef.current) {
        // Ensure clock is running
        if (!clockRef.current) {
          clockRef.current = new THREE.Clock();
          clockRef.current.start();
        }
        
        const delta = clockRef.current.getDelta();
        // Rotate smoothly based on elapsed time
        modelRef.current.rotation.y += delta * 0.8 * rotationSpeed;
      }

      currentRenderer.render(currentScene, currentCamera);
    };

    // Handle window resize
    const handleResize = () => {
      const currentRenderer = rendererRef.current;
      const currentCamera = cameraRef.current;
      
      if (!containerRef.current || !currentRenderer || !currentCamera) return;
      
      const newWidth = containerRef.current.clientWidth || width;
      const newHeight = containerRef.current.clientHeight || height;
      
      currentRenderer.setSize(newWidth, newHeight);
      currentCamera.aspect = newWidth / newHeight;
      currentCamera.updateProjectionMatrix();
    };

    // Initialize
    loadThreeJS().then((success) => {
      if (success) {
        initScene();
        window.addEventListener('resize', handleResize);
      }
    });

    // Cleanup on unmount or when component becomes invisible
    return () => {
      window.removeEventListener('resize', handleResize);
      cleanup();
      isInitializedRef.current = false;
    };
  }, [src, width, height, rotationSpeed, isVisible]);

  // Fallback UI while loading or on error
  if (error) {
    return (
      <div 
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width, height }}
        title="3D logo unavailable"
      >
        <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
    );
  }

  // Don't render 3D content if not visible (saves WebGL contexts)
  if (!isVisible) {
    return (
      <div 
        ref={containerRef} 
        className={className}
        style={{ 
          width, 
          height, 
          display: 'inline-block',
          position: 'relative',
        }}
      >
        {/* Placeholder while not visible */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className={className}
      style={{ 
        width, 
        height, 
        display: 'inline-block',
        position: 'relative',
        zIndex: 1, // Ensure canvas is visible above backdrop-blur
        overflow: 'visible' // Allow canvas to render properly
      }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

