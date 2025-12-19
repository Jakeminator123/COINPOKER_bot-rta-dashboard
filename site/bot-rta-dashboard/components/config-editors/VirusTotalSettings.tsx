"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((response) => {
      if (response && typeof response === "object" && "success" in response) {
        return response;
      }
      return response;
    });

interface VTStats {
  totalLookups: number;
  cacheHits: number;
  apiCalls: number;
  malwareFound: number;
  suspiciousFound: number;
  cleanFiles: number;
  unknownFiles: number;
  errors: number;
  lastLookup: string | null;
}

export default function VirusTotalSettings() {
  const [testHash, setTestHash] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Fetch VT stats
  const { data: statsData, error: statsError, mutate: refreshStats } = useSWR<{ success: boolean; stats: VTStats }>(
    "/api/virustotal?action=stats",
    fetcher,
    { refreshInterval: 30000 }
  );

  const stats = statsData?.stats;
  const isConfigured = stats && (stats.apiCalls > 0 || stats.totalLookups > 0);

  // Test API connection
  const handleTestConnection = async () => {
    if (!testHash || testHash.length !== 64) {
      alert("Please enter a valid 64-character SHA256 hash");
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await fetch(`/api/virustotal?hash=${testHash}`);
      const data = await response.json();
      setTestResult(data);
      refreshStats();
    } catch (error) {
      setTestResult({ success: false, error: "Connection failed" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🦠</span>
          <div>
            <h2 className="text-xl font-bold text-white">VirusTotal Integration</h2>
            <p className="text-sm text-slate-400">
              Check unknown executables against 70+ antivirus engines
            </p>
          </div>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${
          isConfigured 
            ? "bg-green-500/20 text-green-400 border border-green-500/30"
            : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
        }`}>
          {isConfigured ? "✓ Active" : "⚠ Not Configured"}
        </div>
      </div>

      {/* Stats Grid */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{stats.totalLookups}</div>
            <div className="text-xs text-slate-400">Total Lookups</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-2xl font-bold text-green-400">{stats.cacheHits}</div>
            <div className="text-xs text-slate-400">Cache Hits</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">{stats.malwareFound}</div>
            <div className="text-xs text-slate-400">Malware Found</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-400">{stats.apiCalls}</div>
            <div className="text-xs text-slate-400">API Calls</div>
          </div>
        </motion.div>
      )}

      {/* Configuration Instructions */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowInstructions(!showInstructions)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🔑</span>
            <div>
              <div className="font-medium text-white">API Key Configuration</div>
              <div className="text-sm text-slate-400">
                {isConfigured 
                  ? "API key is configured and working"
                  : "Click to see setup instructions"
                }
              </div>
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-slate-400 transition-transform ${showInstructions ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showInstructions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="border-t border-slate-700 p-4 space-y-4"
          >
            <div className="text-sm text-slate-300 space-y-3">
              <p>
                <strong>To enable VirusTotal integration:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-2 text-slate-400">
                <li>
                  Get a free API key from{" "}
                  <a
                    href="https://www.virustotal.com/gui/my-apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 underline"
                  >
                    virustotal.com
                  </a>
                </li>
                <li>
                  Add the key to your environment:
                  <code className="block mt-1 p-2 bg-slate-900 rounded text-xs font-mono text-green-400">
                    VIRUSTOTAL_API_KEY=your_api_key_here
                  </code>
                </li>
                <li>Restart the dashboard server</li>
              </ol>
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-400">⚠️</span>
                  <div className="text-xs text-yellow-300">
                    <strong>Rate Limits:</strong> Free tier allows 4 requests/minute. 
                    Results are cached for 24 hours to minimize API usage.
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Test Hash Lookup */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">🔍</span>
          <div>
            <div className="font-medium text-white">Test Hash Lookup</div>
            <div className="text-sm text-slate-400">Enter a SHA256 hash to test the connection</div>
          </div>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={testHash}
            onChange={(e) => setTestHash(e.target.value)}
            placeholder="Enter 64-character SHA256 hash..."
            className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleTestConnection}
            disabled={isTesting || !testHash}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
          >
            {isTesting ? "Testing..." : "Test"}
          </button>
        </div>

        {testResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-4 p-4 rounded-lg border ${
              testResult.success && testResult.result?.status === "clean"
                ? "bg-green-500/10 border-green-500/30"
                : testResult.success && testResult.result?.status === "malicious"
                ? "bg-red-500/10 border-red-500/30"
                : testResult.success && testResult.result?.status === "suspicious"
                ? "bg-yellow-500/10 border-yellow-500/30"
                : "bg-slate-800/50 border-slate-700"
            }`}
          >
            {testResult.success ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{testResult.result?.label || "Result"}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    testResult.result?.status === "clean" ? "bg-green-500/20 text-green-400" :
                    testResult.result?.status === "malicious" ? "bg-red-500/20 text-red-400" :
                    testResult.result?.status === "suspicious" ? "bg-yellow-500/20 text-yellow-400" :
                    "bg-slate-700 text-slate-300"
                  }`}>
                    {testResult.result?.severity || testResult.result?.status}
                  </span>
                </div>
                <p className="text-sm text-slate-400">{testResult.result?.reason}</p>
                {testResult.result?.stats && (
                  <div className="flex gap-4 text-xs text-slate-500 mt-2">
                    <span>Malicious: {testResult.result.stats.malicious}</span>
                    <span>Suspicious: {testResult.result.stats.suspicious}</span>
                    <span>Clean: {testResult.result.stats.harmless}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-red-400 text-sm">
                {testResult.error || "Lookup failed"}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Last Lookup Info */}
      {stats?.lastLookup && (
        <div className="text-xs text-slate-500 text-center">
          Last lookup: {new Date(stats.lastLookup).toLocaleString()}
        </div>
      )}
    </div>
  );
}

