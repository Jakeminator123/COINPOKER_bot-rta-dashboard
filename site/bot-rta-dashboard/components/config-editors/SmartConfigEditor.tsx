"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface SmartConfigEditorProps {
  category: string;
  config?: any;
  onSave: (category: string, updates: any) => Promise<void>;
}

export default function SmartConfigEditor({
  category,
  config,
  onSave,
}: SmartConfigEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editedConfig, setEditedConfig] = useState(config || {});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Update editedConfig when config prop changes
  useEffect(() => {
    if (config) {
      setEditedConfig(config);
    }
  }, [config]);

  const handleSave = async () => {
    if (!editedConfig) return;

    setIsSaving(true);
    setMessage(null);
    try {
      await onSave(category, editedConfig);
      setMessage({
        type: "success",
        text: `${category} config saved successfully`,
      });
    } catch (error) {
      setMessage({ type: "error", text: `Failed to save ${category} config` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfigChange = (key: string, value: any, path: string = "") => {
    setEditedConfig((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone

      if (path) {
        // Handle array paths like "poker_sites.other[0]"
        if (path.includes("[")) {
          const arrayMatch = path.match(/^(.+)\[(\d+)\]$/);
          if (arrayMatch) {
            const [, arrayPath, indexStr] = arrayMatch;
            const index = parseInt(indexStr, 10);
            const pathParts = arrayPath.split(".");
            let current: any = updated;
            for (const part of pathParts) {
              if (current[part] === undefined) current[part] = {};
              current = current[part];
            }
            if (Array.isArray(current)) {
              if (key) {
                // Update property in array item object
                if (index >= 0 && index < current.length && current[index]) {
                  current[index] = { ...current[index], [key]: value };
                }
              } else {
                // Update entire array item - ensure array is large enough
                if (index >= 0) {
                  // Extend array if index is beyond current length
                  while (current.length <= index) {
                    current.push(undefined);
                  }
                  current[index] = value;
                }
              }
            }
            return updated;
          }
        }

        // Handle nested object paths like "automation_tools.high_risk.autohotkey"
        const pathParts = path.split(".");
        let current: any = updated;
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (current[part] === undefined) current[part] = {};
          current = current[part];
        }
        const lastPart = pathParts[pathParts.length - 1];
        if (key) {
          // Update nested property
          if (current[lastPart] === undefined) current[lastPart] = {};
          current[lastPart] = { ...current[lastPart], [key]: value };
        } else {
          // Update entire nested object
          current[lastPart] = value;
        }
      } else {
        // Update top-level value
        updated[key] = value;
      }

      return updated;
    });
  };

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderValue = (
    key: string,
    value: any,
    path: string = ""
  ): React.ReactNode => {
    const fullPath = path ? `${path}.${key}` : key;
    const isExpanded = expandedKeys.has(fullPath);
    const STATUS_OPTIONS = ["INFO", "WARN", "ALERT", "CRITICAL"];

    // Friendly descriptions for common sections
    const sectionDescriptions: Record<string, string> = {
      telegram_detection:
        "Detect active Telegram connections only; token scanning is disabled. Alerts consider CoinPoker foreground and known Telegram networks.",
      web_monitoring:
        "Monitor browser patterns and domains related to RTA/messengers. Configure keywords and suspicious pattern mappings.",
      traffic_monitoring:
        "Track active connections, ports and domains for suspicious services. Uses short TTL caches to avoid duplicates.",
      kind_categories:
        "Human-friendly category descriptions used to explain detection groupings in the UI.",
    };

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const entries = Object.entries(value);
      const isLarge = entries.length > 5;

      // Special-case: render _points_mapping as a compact editable table
      const isPointsMapping =
        key === "_points_mapping" &&
        entries.every(
          ([, v]) =>
            typeof v === "object" &&
            v !== null &&
            ("status" in (v as any) || "description" in (v as any))
        );

      if (isPointsMapping) {
        const sortedPointKeys = entries
          .map(([k]) => k)
          .sort((a, b) => Number(a) - Number(b));

        return (
          <div
            key={key}
            className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
          >
            <div className="mb-3">
              <label className="block text-sm font-medium text-white">
                {key
                  .replace(/^_/, "")
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase())}
              </label>
              <p className="text-xs text-slate-400 mt-1">
                Map threat status and description per points threshold.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-300">
                    <th className="py-2 pr-4 font-medium">Points</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  {sortedPointKeys.map((pKey) => {
                    const row = (value as any)[pKey] ?? {};
                    return (
                      <tr key={pKey} className="border-t border-slate-700/50">
                        <td className="py-2 pr-4 text-slate-200">{pKey}</td>
                        <td className="py-2 pr-4">
                          <select
                            value={row.status ?? ""}
                            onChange={(e) =>
                              handleConfigChange(
                                "status",
                                e.target.value,
                                `${fullPath}.${pKey}`
                              )
                            }
                            className="px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-4 w-full">
                          <input
                            type="text"
                            value={row.description ?? ""}
                            onChange={(e) =>
                              handleConfigChange(
                                "description",
                                e.target.value,
                                `${fullPath}.${pKey}`
                              )
                            }
                            placeholder="Description"
                            className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // Special-case: suspicious_patterns (pattern => [label, status])
      const isSuspiciousPatterns =
        key === "suspicious_patterns" &&
        entries.every(
          ([, v]) =>
            Array.isArray(v) &&
            (v.length === 2 || v.length === 0 || v.length === 1)
        );

      if (isSuspiciousPatterns) {
        const sortedKeys = entries.map(([k]) => k).sort();

        const updateRow = (
          patternKey: string,
          label: string,
          status: string
        ) => {
          const current = value as Record<string, any[]>;
          const updated: Record<string, any[]> = {
            ...current,
            [patternKey]: [label, status],
          };
          handleConfigChange("", updated, fullPath);
        };

        const renameKey = (oldKey: string, newKey: string) => {
          if (!newKey || oldKey === newKey) return;
          const current = value as Record<string, any[]>;
          if (newKey in current) return; // avoid overwrite
          const updated: Record<string, any[]> = { ...current };
          updated[newKey] = updated[oldKey];
          delete updated[oldKey];
          handleConfigChange("", updated, fullPath);
        };

        const removeRow = (patternKey: string) => {
          const current = value as Record<string, any[]>;
          const updated: Record<string, any[]> = { ...current };
          delete updated[patternKey];
          handleConfigChange("", updated, fullPath);
        };

        const addRow = () => {
          const base = "example.pattern";
          let name = base;
          let i = 1;
          const current = value as Record<string, any[]>;
          while (name in current) {
            name = `${base}.${i++}`;
          }
          const updated: Record<string, any[]> = {
            ...current,
            [name]: ["Label", "INFO"],
          };
          handleConfigChange("", updated, fullPath);
        };

        return (
          <div
            key={key}
            className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="block text-sm font-medium text-white">
                  Suspicious Patterns
                </label>
                <p className="text-xs text-slate-400 mt-1">
                  Map domains/keywords to a label and severity.
                </p>
              </div>
              <button
                onClick={addRow}
                className="text-xs text-green-400 hover:text-green-300 px-2 py-1 bg-green-500/10 rounded"
              >
                + Add Pattern
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-300">
                    <th className="py-2 pr-4 font-medium">Pattern</th>
                    <th className="py-2 pr-4 font-medium">Label</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedKeys.map((pKey) => {
                    const arr = (value as Record<string, any[]>)[pKey] ?? [];
                    const label = arr[0] ?? "";
                    const status = arr[1] ?? "INFO";
                    return (
                      <tr key={pKey} className="border-t border-slate-700/50">
                        <td className="py-2 pr-4">
                          <input
                            type="text"
                            value={pKey}
                            onChange={(e) => renameKey(pKey, e.target.value)}
                            className="w-64 px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="text"
                            value={label}
                            onChange={(e) =>
                              updateRow(pKey, e.target.value, status)
                            }
                            className="w-full px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <select
                            value={status}
                            onChange={(e) =>
                              updateRow(pKey, label, e.target.value)
                            }
                            className="px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-4">
                          <button
                            onClick={() => removeRow(pKey)}
                            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // Special-case: suspicious_ports (port => description)
      const isSuspiciousPorts =
        key === "suspicious_ports" &&
        entries.every(([, v]) => typeof v === "string");

      if (isSuspiciousPorts) {
        const sortedKeys = entries
          .map(([k]) => k)
          .sort((a, b) => Number(a) - Number(b));

        const updateMap = (k: string, v: string) => {
          const updated = { ...(value as Record<string, string>), [k]: v };
          handleConfigChange("", updated, fullPath);
        };
        const renameKey = (oldKey: string, newKey: string) => {
          if (!newKey || oldKey === newKey) return;
          const current = value as Record<string, string>;
          if (newKey in current) return;
          const updated: Record<string, string> = { ...current };
          updated[newKey] = updated[oldKey];
          delete updated[oldKey];
          handleConfigChange("", updated, fullPath);
        };
        const removeKey = (k: string) => {
          const updated: Record<string, string> = { ...(value as any) };
          delete updated[k];
          handleConfigChange("", updated, fullPath);
        };
        const addKey = () => {
          const base = "1234";
          let name = base;
          let i = 1;
          const current = value as Record<string, string>;
          while (name in current) name = `${base}${i++}`;
          const updated = { ...current, [name]: "Description" };
          handleConfigChange("", updated, fullPath);
        };

        return (
          <div
            key={key}
            className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
          >
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-white">
                Suspicious Ports
              </label>
              <button
                onClick={addKey}
                className="text-xs text-green-400 hover:text-green-300 px-2 py-1 bg-green-500/10 rounded"
              >
                + Add Port
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-300">
                    <th className="py-2 pr-4 font-medium">Port</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedKeys.map((port) => (
                    <tr key={port} className="border-t border-slate-700/50">
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={port}
                          onChange={(e) => renameKey(port, e.target.value)}
                          className="w-28 px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={(value as any)[port]}
                          onChange={(e) => updateMap(port, e.target.value)}
                          className="w-full px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => removeKey(port)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // Special-case: suspicious_domains (pattern => label)
      const isSuspiciousDomains =
        key === "suspicious_domains" &&
        entries.every(([, v]) => typeof v === "string");

      if (isSuspiciousDomains) {
        const sortedKeys = entries.map(([k]) => k).sort();
        const updateMap = (k: string, v: string) => {
          const updated = { ...(value as Record<string, string>), [k]: v };
          handleConfigChange("", updated, fullPath);
        };
        const renameKey = (oldKey: string, newKey: string) => {
          if (!newKey || oldKey === newKey) return;
          const current = value as Record<string, string>;
          if (newKey in current) return;
          const updated: Record<string, string> = { ...current };
          updated[newKey] = updated[oldKey];
          delete updated[oldKey];
          handleConfigChange("", updated, fullPath);
        };
        const removeKey = (k: string) => {
          const updated: Record<string, string> = { ...(value as any) };
          delete updated[k];
          handleConfigChange("", updated, fullPath);
        };
        const addKey = () => {
          const base = "pattern.example";
          let name = base;
          let i = 1;
          const current = value as Record<string, string>;
          while (name in current) name = `${base}.${i++}`;
          const updated = { ...current, [name]: "Label" };
          handleConfigChange("", updated, fullPath);
        };

        return (
          <div
            key={key}
            className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
          >
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-white">
                Suspicious Domains
              </label>
              <button
                onClick={addKey}
                className="text-xs text-green-400 hover:text-green-300 px-2 py-1 bg-green-500/10 rounded"
              >
                + Add Pattern
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-300">
                    <th className="py-2 pr-4 font-medium">Pattern</th>
                    <th className="py-2 pr-4 font-medium">Label</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedKeys.map((pattern) => (
                    <tr key={pattern} className="border-t border-slate-700/50">
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={pattern}
                          onChange={(e) => renameKey(pattern, e.target.value)}
                          className="w-64 px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={(value as any)[pattern]}
                          onChange={(e) => updateMap(pattern, e.target.value)}
                          className="w-full px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => removeKey(pattern)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // Special-case: communication_apps (process => { name, status, points, desc })
      const isCommunicationApps =
        key === "communication_apps" &&
        entries.every(
          ([, v]) => typeof v === "object" && v !== null && !Array.isArray(v)
        );

      if (isCommunicationApps) {
        const sortedKeys = entries.map(([k]) => k).sort();

        const updateRow = (
          proc: string,
          field: "name" | "status" | "points" | "desc",
          val: string | number
        ) => {
          const current = value as Record<string, any>;
          const nextRow = { ...(current[proc] || {}) };
          (nextRow as any)[field] = val;
          const updated = { ...current, [proc]: nextRow };
          handleConfigChange("", updated, fullPath);
        };
        const renameKey = (oldKey: string, newKey: string) => {
          if (!newKey || oldKey === newKey) return;
          const current = value as Record<string, any>;
          if (newKey in current) return;
          const updated: Record<string, any> = { ...current };
          updated[newKey] = updated[oldKey];
          delete updated[oldKey];
          handleConfigChange("", updated, fullPath);
        };
        const removeRow = (k: string) => {
          const updated: Record<string, any> = { ...(value as any) };
          delete updated[k];
          handleConfigChange("", updated, fullPath);
        };
        const addRow = () => {
          const base = "process.exe";
          let name = base;
          let i = 1;
          const current = value as Record<string, any>;
          while (name in current) name = `${base}${i++}`;
          const updated = {
            ...current,
            [name]: { name: "App", status: "INFO", points: 0, desc: "" },
          };
          handleConfigChange("", updated, fullPath);
        };

        return (
          <div
            key={key}
            className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
          >
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-white">
                Communication Apps
              </label>
              <button
                onClick={addRow}
                className="text-xs text-green-400 hover:text-green-300 px-2 py-1 bg-green-500/10 rounded"
              >
                + Add App
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-300">
                    <th className="py-2 pr-4 font-medium">Process</th>
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Points</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedKeys.map((proc) => {
                    const row = (value as any)[proc] ?? {};
                    return (
                      <tr key={proc} className="border-t border-slate-700/50">
                        <td className="py-2 pr-4">
                          <input
                            type="text"
                            value={proc}
                            onChange={(e) => renameKey(proc, e.target.value)}
                            className="w-48 px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="text"
                            value={row.name ?? ""}
                            onChange={(e) =>
                              updateRow(proc, "name", e.target.value)
                            }
                            className="w-44 px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <select
                            value={row.status ?? "INFO"}
                            onChange={(e) =>
                              updateRow(proc, "status", e.target.value)
                            }
                            className="px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-4">
                          <select
                            value={Number(row.points ?? 0)}
                            onChange={(e) =>
                              updateRow(proc, "points", Number(e.target.value))
                            }
                            className="px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          >
                            {[0, 5, 10, 15].map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="text"
                            value={row.desc ?? ""}
                            onChange={(e) =>
                              updateRow(proc, "desc", e.target.value)
                            }
                            className="w-full px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <button
                            onClick={() => removeRow(proc)}
                            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // Special-case: kind_categories (key => description)
      const isKindCategories =
        key === "kind_categories" &&
        entries.every(([, v]) => typeof v === "string");

      if (isKindCategories) {
        const sorted = entries.map(([k]) => k).sort();
        const updateMap = (k: string, v: string) => {
          const updated = { ...(value as Record<string, string>), [k]: v };
          handleConfigChange("", updated, fullPath);
        };
        const renameKey = (oldKey: string, newKey: string) => {
          if (!newKey || oldKey === newKey) return;
          const current = value as Record<string, string>;
          if (newKey in current) return;
          const updated: Record<string, string> = { ...current };
          updated[newKey] = updated[oldKey];
          delete updated[oldKey];
          handleConfigChange("", updated, fullPath);
        };
        const removeKey = (k: string) => {
          const updated: Record<string, string> = { ...(value as any) };
          delete updated[k];
          handleConfigChange("", updated, fullPath);
        };
        const addKey = () => {
          const base = "new_category";
          let name = base;
          let i = 1;
          const current = value as Record<string, string>;
          while (name in current) name = `${base}_${i++}`;
          const updated = { ...current, [name]: "Description" };
          handleConfigChange("", updated, fullPath);
        };

        return (
          <div
            key={key}
            className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
          >
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-white">
                Kind Categories
              </label>
              <button
                onClick={addKey}
                className="text-xs text-green-400 hover:text-green-300 px-2 py-1 bg-green-500/10 rounded"
              >
                + Add Category
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-300">
                    <th className="py-2 pr-4 font-medium">Key</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((k) => (
                    <tr key={k} className="border-t border-slate-700/50">
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={k}
                          onChange={(e) => renameKey(k, e.target.value)}
                          className="w-52 px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={(value as any)[k]}
                          onChange={(e) => updateMap(k, e.target.value)}
                          className="w-full px-2 py-1 bg-slate-700 text-white rounded border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => removeKey(k)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // Check if this looks like a points mapping or similar structured object
      const isStructuredObject = entries.every(
        ([_k, v]) =>
          typeof v === "object" &&
          v !== null &&
          !Array.isArray(v) &&
          ("status" in v || "display" in v || "points" in v || "process" in v)
      );

      return (
        <div
          key={key}
          className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50"
        >
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-white">
              {key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </label>
            {/* Optional section helper */}
            {sectionDescriptions[key] && (
              <span className="ml-4 text-xs text-slate-400">
                {sectionDescriptions[key]}
              </span>
            )}
            {isLarge && (
              <button
                onClick={() => toggleExpand(fullPath)}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 bg-indigo-500/10 rounded"
              >
                {isExpanded ? "Collapse" : "Expand"}
              </button>
            )}
          </div>
          <AnimatePresence>
            {(isExpanded || !isLarge) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className={`space-y-3 ${
                  isStructuredObject
                    ? ""
                    : "ml-4 border-l-2 border-slate-700 pl-4"
                }`}
              >
                {entries.map(([subKey, subValue]) =>
                  renderValue(subKey, subValue, fullPath)
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    if (Array.isArray(value)) {
      const isLarge = value.length > 10;
      const isStringArray = value.every((item) => typeof item === "string");

      return (
        <div key={key} className="p-4 bg-slate-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-white">
              {key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </label>
            <div className="flex items-center gap-2">
              {isLarge && (
                <button
                  onClick={() => toggleExpand(fullPath)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {isExpanded ? "Collapse" : "Expand"}
                </button>
              )}
              {isStringArray && (
                <button
                  onClick={() => {
                    const newValue = [...value, ""];
                    handleConfigChange(key, newValue, path);
                  }}
                  className="text-xs text-green-400 hover:text-green-300 transition-colors px-2 py-1 bg-green-500/10 rounded"
                  title="Add item"
                >
                  + Add
                </button>
              )}
            </div>
          </div>
          <AnimatePresence>
            {(isExpanded || !isLarge) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2 ml-4"
              >
                {value.map((item: any, idx: number) => {
                  if (isStringArray) {
                    // Editable string array items
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={String(item)}
                          onChange={(e) => {
                            const newArray = [...value];
                            newArray[idx] = e.target.value;
                            handleConfigChange(key, newArray, path);
                          }}
                          className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none text-sm"
                          placeholder="Enter value..."
                        />
                        <button
                          onClick={() => {
                            const newArray = value.filter(
                              (_: any, i: number) => i !== idx
                            );
                            handleConfigChange(key, newArray, path);
                          }}
                          className="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/10 rounded transition-colors"
                          title="Remove item"
                        >
                          ×
                        </button>
                      </div>
                    );
                  } else if (typeof item === "object" && item !== null) {
                    // Nested objects in array - render recursively
                    return (
                      <div
                        key={idx}
                        className="bg-slate-900/50 p-3 rounded border border-slate-700"
                      >
                        <div className="text-xs text-slate-400 mb-2">
                          Item {idx + 1}
                        </div>
                        <div className="space-y-2">
                          {Object.entries(item).map(([subKey, subValue]) =>
                            renderValue(subKey, subValue, `${fullPath}[${idx}]`)
                          )}
                        </div>
                      </div>
                    );
                  } else {
                    // Simple values
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={String(item)}
                          onChange={(e) => {
                            const newArray = [...value];
                            newArray[idx] = e.target.value;
                            handleConfigChange(key, newArray, path);
                          }}
                          className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none text-sm"
                        />
                        <button
                          onClick={() => {
                            const newArray = value.filter(
                              (_: any, i: number) => i !== idx
                            );
                            handleConfigChange(key, newArray, path);
                          }}
                          className="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/10 rounded transition-colors"
                          title="Remove item"
                        >
                          ×
                        </button>
                      </div>
                    );
                  }
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    if (typeof value === "boolean") {
      return (
        <div key={key} className="p-4 bg-slate-800/50 rounded-lg">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => handleConfigChange(key, e.target.checked, path)}
              className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-white">
              {key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </span>
            <span className="text-sm text-slate-400">
              {value ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>
      );
    }

    if (typeof value === "number") {
      return (
        <div key={key} className="p-4 bg-slate-800/50 rounded-lg">
          <label className="block text-sm font-medium text-white mb-2">
            {key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
          </label>
          <input
            type="number"
            value={value}
            onChange={(e) =>
              handleConfigChange(key, Number(e.target.value), path)
            }
            className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      );
    }

    return (
      <div key={key} className="p-4 bg-slate-800/50 rounded-lg">
        <label className="block text-sm font-medium text-white mb-2">
          {key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
        </label>
        <input
          type="text"
          value={String(value)}
          onChange={(e) => handleConfigChange(key, e.target.value, path)}
          className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none"
        />
      </div>
    );
  };

  if (!config) {
    return (
      <div className="glass-card p-6">
        <div className="text-center text-slate-400 py-8">
          <p>No configuration data available for {category}</p>
          <p className="text-sm mt-2">
            Make sure the dashboard API is running.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-lg ${
            message.type === "success"
              ? "bg-green-500/20 text-green-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {message.text}
        </motion.div>
      )}

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">
              {category
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase())}
            </h3>
            <p className="text-slate-400 text-sm">
              Edit configuration values for {category}
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        <div className="space-y-4">
          {Object.entries(editedConfig).map(([key, value]) =>
            renderValue(key, value)
          )}
        </div>
      </div>
    </div>
  );
}
