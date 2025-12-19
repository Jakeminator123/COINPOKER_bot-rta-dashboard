/**
 * Login Page - V0 Hero Style
 * ==========================
 * Alias: "Login" | "Authentication" | "Sign In"
 * Route: /login
 * File: app/login/page.tsx
 *
 * Beautiful poker-themed login page with:
 * - Video background with shimmer overlay
 * - Floating poker cards and chips
 * - 3D flipping card with login form
 * - NextAuth integration
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { gsap } from "gsap";
import { User, Lock, LogIn } from "lucide-react";
import dynamic from "next/dynamic";

// Dynamic import for 3D logo to avoid SSR issues
const SpinningLogo3D = dynamic(() => import("@/components/SpinningLogo3D"), {
  ssr: false,
  loading: () => (
    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 animate-pulse" />
  ),
});

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Card flip states - default to flipped to show login form
  const cardRef = useRef<HTMLDivElement>(null);
  const botCardRef = useRef<HTMLDivElement>(null);
  const [isNearCard, setIsNearCard] = useState(true); // Start flipped to show login
  const [isNearBotCard, setIsNearBotCard] = useState(false);

  const { status } = useSession();

  useEffect(() => {
    setMounted(true);
    if (status === "authenticated") router.push("/");
  }, [router, status]);

  // Mouse proximity detection for card flipping
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const cardElement = cardRef.current;
      const botCardElement = botCardRef.current;

      if (cardElement) {
        const rect = cardElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.sqrt(
          Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2)
        );
        setIsNearCard(distance < 300);
      }

      if (botCardElement) {
        const rect = botCardElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.sqrt(
          Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2)
        );
        setIsNearBotCard(distance < 300);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    if (res?.ok) {
      router.push("/");
    } else {
      setError("Invalid username or password");
      setIsLoading(false);
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <section className="p-[1.5%] bg-zinc-950 min-h-screen">
      {/* SVG Mask for the hero shape */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <mask id="heroMask" maskContentUnits="objectBoundingBox">
            <rect width="1" height="1" fill="black" />
            <path
              d="M0 0.1474 V0.9863 C0 0.9938 0.0038 0.9996 0.0085 0.9996 H0.9912 C0.9958 0.9996 1 0.9863 1 0.9863 V0.0581 C1 0.0506 0.9958 0.0444 0.9912 0.0444 H0.9255 C0.9208 0.0444 0.9165 0.0383 0.9165 0.0307 V0.0149 C0.9165 0.0074 0.9132 0.0013 0.9084 0.0013 L0.2060 0.0000 C0.2012 -0.0000 0.1975 0.0061 0.1975 0.0137 V0.0312 C0.1975 0.0387 0.1936 0.0448 0.1889 0.0448 H0.0915 C0.0868 0.0448 0.0830 0.0510 0.0830 0.0585 V0.1201 C0.0830 0.1276 0.0792 0.1337 0.0745 0.1337 H0.0085 C0.0038 0.1337 0 0.1399 0 0.1474 Z"
              fill="white"
            />
          </mask>
        </defs>
      </svg>

      <div className="relative isolate w-full min-h-[calc(100svh-3vh)]">
        {/* Background Layer with Mask */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            mask: "url(#heroMask)",
            WebkitMask: "url(#heroMask)",
          }}
        >
          {/* Video Background - Liquid metal effect */}
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source 
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/liquid-metal-video_yX6NvjdW-6bLYorR3Ihmlwjivg3pjA978qrSKRU.mp4" 
              type="video/mp4" 
            />
          </video>

          {/* Fallback gradient if video doesn't load */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900/50 to-slate-900" />

          {/* Shimmer Overlay */}
          <div className="pointer-events-none absolute inset-0 shimmer-overlay">
            <div className="absolute inset-0 bg-gradient-to-br from-pink-500/70 via-purple-500/70 to-fuchsia-600/70 opacity-70 animate-shimmer" />
          </div>

          {/* Color Overlay */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/60 via-purple-800/60 to-pink-600/60" />
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/25 via-transparent to-zinc-950/45" />
          </div>

          {/* Floating Poker Elements */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
            {/* Playing Cards */}
            <div className="absolute top-[15%] left-[10%] w-20 h-28 bg-white rounded-lg shadow-2xl opacity-40 animate-float-slow">
              <div className="p-2 text-red-600 font-bold text-xl">A♥</div>
            </div>
            <div className="absolute top-[25%] right-[15%] w-20 h-28 bg-white rounded-lg shadow-2xl opacity-30 animate-float-medium">
              <div className="p-2 text-black font-bold text-xl">K♠</div>
            </div>
            <div className="absolute bottom-[30%] left-[8%] w-20 h-28 bg-white rounded-lg shadow-2xl opacity-35 animate-float-slow-reverse">
              <div className="p-2 text-red-600 font-bold text-xl">Q♦</div>
            </div>
            <div className="absolute bottom-[20%] right-[12%] w-20 h-28 bg-white rounded-lg shadow-2xl opacity-40 animate-float-medium-reverse">
              <div className="p-2 text-black font-bold text-xl">J♣</div>
            </div>

            {/* Poker Chips */}
            <div className="absolute top-[40%] left-[5%] animate-float-chip">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-red-500 to-red-700 border-4 border-white shadow-xl" />
                <div className="absolute inset-2 rounded-full border-2 border-white/30" />
                <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-xs">
                  $100
                </div>
              </div>
            </div>
            <div className="absolute top-[60%] right-[8%] animate-float-chip-reverse">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 border-4 border-white shadow-xl" />
                <div className="absolute inset-2 rounded-full border-2 border-white/30" />
                <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-xs">
                  $50
                </div>
              </div>
            </div>
            <div className="absolute bottom-[15%] left-[20%] animate-float-chip-slow">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-green-500 to-green-700 border-4 border-white shadow-xl" />
                <div className="absolute inset-2 rounded-full border-2 border-white/30" />
                <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-xs">
                  $25
                </div>
              </div>
            </div>

            {/* Bot Icon */}
            <div className="absolute top-[50%] right-[5%] opacity-25 animate-float-slow">
              <div className="relative w-32 h-32">
                <svg
                  viewBox="0 0 24 24"
                  className="w-full h-full text-purple-300"
                  fill="currentColor"
                >
                  <path d="M12 2c-.5 0-1 .19-1.41.59l-1 1c-.38.38-.59.88-.59 1.41v1h6V5c0-.53-.21-1.03-.59-1.41l-1-1C13.03 2.19 12.53 2 12 2zm-7 6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2H5zm2 3h2v2H7v-2zm8 0h2v2h-2v-2zm-4 3c1.66 0 3 1.34 3 3h-6c0-1.66 1.34-3 3-3z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Centered Logo */}
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-4 pointer-events-auto">
              {/* 3D Spinning Logo */}
              <div className="p-6 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 backdrop-blur-sm shadow-2xl shadow-indigo-500/20">
                <SpinningLogo3D 
                  src="/coin_logo.glb" 
                  width={120}
                  height={120}
                  rotationSpeed={0.5}
                />
              </div>
              {/* Title under logo */}
              <div className="text-center">
                <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-lg">
                  Bot & RTA Detection
                </h1>
                <p className="text-slate-400 text-sm mt-1">Real-time player monitoring</p>
              </div>
            </div>
          </div>

          {/* Cards Container */}
          <div className="absolute bottom-6 left-6 right-6 max-w-[min(46rem,92vw)] md:bottom-8 md:left-8 z-10 flex items-center justify-center gap-4">
            {/* Small Bot Card */}
            <div
              ref={botCardRef}
              className="relative w-[140px] h-[200px] md:w-[160px] md:h-[230px] perspective-1000 -rotate-6 opacity-80 hover:opacity-100 transition-all duration-500"
              style={{
                transformStyle: "preserve-3d",
                transform: isNearBotCard
                  ? "rotateY(180deg) rotate(-6deg)"
                  : "rotateY(0deg) rotate(-6deg)",
              }}
            >
              {/* Front - Red pattern card */}
              <div
                className="absolute inset-0 backface-hidden rounded-xl bg-gradient-to-br from-red-600 via-red-700 to-red-900 border-4 border-white shadow-2xl"
                style={{ backfaceVisibility: "hidden" }}
              >
                <div className="absolute inset-2 rounded-lg border-2 border-white/30">
                  <div className="absolute inset-2 rounded-lg bg-gradient-to-br from-red-800/50 to-red-900/50">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-24 h-24 opacity-40">
                        <svg
                          viewBox="0 0 100 100"
                          className="w-full h-full text-white"
                        >
                          <circle
                            cx="50"
                            cy="50"
                            r="30"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            d="M50 20 L50 35 M50 65 L50 80 M20 50 L35 50 M65 50 L80 50"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="15"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.05)_10px,rgba(255,255,255,0.05)_20px)]" />
                  </div>
                </div>
              </div>

              {/* Back - Bot Detected */}
              <div
                className="absolute inset-0 backface-hidden rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-black border-4 border-red-500/50 shadow-2xl"
                style={{
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-full h-full text-red-500"
                    fill="currentColor"
                  >
                    <path d="M12 2c-.5 0-1 .19-1.41.59l-1 1c-.38.38-.59.88-.59 1.41v1h6V5c0-.53-.21-1.03-.59-1.41l-1-1C13.03 2.19 12.53 2 12 2zm-7 6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2H5zm2 3h2v2H7v-2zm8 0h2v2h-2v-2zm-4 3c1.66 0 3 1.34 3 3h-6c0-1.66 1.34-3 3-3z" />
                  </svg>
                </div>
                <div className="absolute bottom-2 left-0 right-0 text-center">
                  <span className="text-red-500 font-bold text-xs md:text-sm">
                    BOT DETECTED
                  </span>
                </div>
              </div>
            </div>

            {/* Main Login Card */}
            <div
              ref={cardRef}
              className="relative w-[280px] h-[400px] md:w-[320px] md:h-[450px] perspective-1000 rotate-3 transition-transform duration-500"
              style={{
                transformStyle: "preserve-3d",
                transform: isNearCard
                  ? "rotateY(180deg) rotate(3deg)"
                  : "rotateY(0deg) rotate(3deg)",
              }}
            >
              {/* Front - Purple gradient card */}
              <div
                className="absolute inset-0 backface-hidden rounded-xl bg-gradient-to-br from-blue-600 via-purple-700 to-pink-700 border-4 border-white shadow-2xl"
                style={{ backfaceVisibility: "hidden" }}
              >
                <div className="absolute inset-2 rounded-lg border-2 border-white/30">
                  <div className="absolute inset-2 rounded-lg bg-gradient-to-br from-purple-800/50 to-pink-900/50">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-32 h-32 md:w-40 md:h-40 opacity-40">
                        <svg
                          viewBox="0 0 100 100"
                          className="w-full h-full text-white"
                        >
                          <circle
                            cx="50"
                            cy="50"
                            r="30"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            d="M50 20 L50 35 M50 65 L50 80 M20 50 L35 50 M65 50 L80 50"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="15"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            d="M35 35 L65 65 M65 35 L35 65"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.05)_10px,rgba(255,255,255,0.05)_20px)]" />

                    <div className="absolute top-2 left-2 text-white font-bold text-xs md:text-sm">
                      ★
                    </div>
                    <div className="absolute bottom-2 right-2 text-white font-bold text-xs md:text-sm rotate-180">
                      ★
                    </div>
                  </div>
                </div>
              </div>

              {/* Back - Login Form */}
              <div
                className="absolute inset-0 backface-hidden backdrop-blur-xl bg-slate-900/90 border-4 border-purple-500/50 rounded-xl p-6 md:p-8 shadow-2xl shadow-purple-500/20"
                style={{
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                }}
              >
                {/* Shield Icon */}
                <div className="flex justify-center mb-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center shadow-lg shadow-red-500/50">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-8 h-8 text-white"
                      fill="currentColor"
                    >
                      <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" />
                    </svg>
                  </div>
                </div>

                <h1 className="text-center text-xl md:text-2xl font-bold mb-1 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Bot & RTA Detection
                </h1>

                <h2 className="text-center text-lg md:text-xl font-semibold text-white mb-6">
                  Sign In
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Username */}
                  <div>
                    <label
                      htmlFor="username"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
                      Username
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter your username"
                        className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-10 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="password"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••••••"
                        className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-10 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-2">
                      <p className="text-red-400 text-xs text-center">{error}</p>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-500 hover:via-purple-500 hover:to-pink-500 text-white font-semibold py-2.5 px-4 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Sign In</span>
                      </>
                    )}
                  </button>

                  <p className="text-center text-xs text-gray-400 mt-3">
                    Use your admin credentials
                  </p>
                </form>

                <div className="mt-6 pt-4 border-t border-slate-700/50">
                  <p className="text-center text-[10px] text-gray-500">
                    © 2025 Bot & RTA Detection System
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top right prompt button */}
        <div className="absolute right-[0.85%] top-[0.75%] z-20">
          <span className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-mono font-light uppercase tracking-[-0.01em] text-white shadow-md">
            BOT DETECTION
          </span>
        </div>
      </div>
    </section>
  );
}
