"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((response) => {
      if (response && typeof response === "object" && "ok" in response && "data" in response) {
        return response.data;
      }
      return response;
    });

interface SHAEntry {
  sha256: string;
  program_name: string;
}

interface SHADatabaseData {
  entries: SHAEntry[];
  meta: {
    version: string;
    last_updated: number;
  };
  searchApplied?: boolean;
  similarityThreshold?: number;
}

export default function SHADatabaseViewer() {
  const [searchTerm, setSearchTerm] = useState("");
  const [similarityThreshold, setSimilarityThreshold] = useState(0.9); // 90% default

  // Build API URL with search and similarity parameters
  const apiUrl = searchTerm
    ? `/api/sha-database?search=${encodeURIComponent(searchTerm)}&similarity=${similarityThreshold}`
    : "/api/sha-database";

  const { data, error, isLoading, mutate } = useSWR<SHADatabaseData>(
    apiUrl,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  );

  const handleDelete = async (sha256: string) => {
    if (!confirm(`Are you sure you want to delete:\n${sha256}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/sha-database?sha256=${sha256}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete entry");
      }

      await mutate();
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete entry");
    }
  };

  const filteredEntries = data?.entries || [];

  if (isLoading) {
    return (
      <div className="glass-card p-8">
        <div className="text-center text-slate-400">Loading SHA database...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-8">
        <div className="text-center text-red-400">Error loading SHA database: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">SHA Database</h2>
          <p className="text-slate-400 text-sm mt-1">
            Simple storage for programs and their SHA256 hashes
          </p>
        </div>
        <div className="text-sm text-slate-400">
          Total: {data?.entries?.length || 0} programs
        </div>
      </div>

      {/* Search with Fuzzy Matching */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by SHA256 or program name (fuzzy matching enabled)..."
            className="flex-1 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        
        {searchTerm && (
          <div className="flex items-center gap-3 text-sm">
            <label className="text-slate-400">Similarity threshold:</label>
            <input
              type="range"
              min="0.5"
              max="1.0"
              step="0.05"
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-indigo-400 font-mono min-w-[3rem] text-right">
              {Math.round(similarityThreshold * 100)}%
            </span>
            <span className="text-slate-500 text-xs">
              ({filteredEntries.length} matches)
            </span>
          </div>
        )}
        
        {searchTerm && (
          <div className="text-xs text-slate-500 bg-slate-800/30 p-2 rounded border border-slate-700/50">
            💡 <strong>Fuzzy matching:</strong> Finds similar program names and SHA256 hashes. 
            Lower threshold (50-70%) finds more matches but may include false positives. 
            Higher threshold (90-95%) finds only very similar entries.
            <br />
            <span className="text-yellow-400">Note:</span> SHA256 hashes are cryptographic - 
            even tiny file changes create completely different hashes. 
            Fuzzy matching works best for finding similar program names or partial hash matches.
          </div>
        )}
      </div>

      {/* Entries List */}
      <div className="glass-card p-6">
        {filteredEntries.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            {data?.entries?.length === 0
              ? "No SHA entries found. Entries will appear here when scanners detect programs with SHA256 hashes."
              : "No entries match your search."}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEntries.map((entry) => (
              <motion.div
                key={entry.sha256}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-slate-800/30 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-lg font-semibold text-white mb-1">
                    {entry.program_name}
                  </div>
                  <div className="text-sm text-slate-300 font-mono break-all">
                    {entry.sha256}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(entry.sha256)}
                  className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm border border-red-500/30 whitespace-nowrap"
                  title="Delete entry"
                >
                  Delete
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
