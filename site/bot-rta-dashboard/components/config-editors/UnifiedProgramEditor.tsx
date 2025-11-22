'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Tooltip from '@/components/Tooltip';
import { getProgramExplanation, getGenericExplanation } from '@/lib/detection-info';
import { useDebounce } from '@/lib/hooks';

type PointsLevel = 0 | 5 | 10 | 15;

interface Program {
  label: string;
  points: PointsLevel;
  type: string;
  categories: string[];
  description?: string;
  kill?: boolean; // Auto-kill this process when detected
}

interface UnifiedProgramEditorProps {
  programs: Record<string, Program>;
  categoryDefinitions: Record<string, { name: string; description: string; default_points: number }>;
  onUpdate: (programs: Record<string, Program>) => Promise<void>;
}

export default function UnifiedProgramEditor({ programs, categoryDefinitions, onUpdate }: UnifiedProgramEditorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPrograms, setSelectedPrograms] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    key: '',
    label: '',
    points: 10 as PointsLevel,
    type: 'bot',
    categories: [] as string[],
    description: '',
    kill: false
  });

  // Get all unique categories from programs
  const allCategories = Array.from(
    new Set(
      Object.values(programs).flatMap(p => p.categories || [])
    )
  ).sort();

  // Filter programs based on search and category (using debounced search for performance)
  const filteredPrograms = useMemo(() => {
    return Object.entries(programs).filter(([key, prog]) => {
      const matchesSearch =
        key.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        prog.label.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (prog.description || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase());

      const matchesCategory =
        selectedCategory === 'all' ||
        (prog.categories || []).includes(selectedCategory);

      return matchesSearch && matchesCategory;
    });
  }, [programs, debouncedSearchTerm, selectedCategory]);

  const pointsColors: Record<PointsLevel, string> = {
    0: 'text-blue-400 bg-blue-500/10',
    5: 'text-yellow-400 bg-yellow-500/10',
    10: 'text-orange-400 bg-orange-500/10',
    15: 'text-red-500 bg-red-600/10'
  };

  const pointsLabels: Record<PointsLevel, string> = {
    0: 'INFO',
    5: 'WARN',
    10: 'ALERT',
    15: 'CRITICAL'
  };

  const typeOptions = ['bot', 'rta', 'solver', 'macro', 'script', 'hud', 'messenger', 'clicker', 'rpa', 'bot_framework'];

  const handleAdd = () => {
    if (formData.key && formData.label && formData.categories.length > 0) {
      const newPrograms = {
        ...programs,
        [formData.key.toLowerCase()]: {
          label: formData.label,
          points: formData.points,
          type: formData.type,
          categories: formData.categories,
          ...(formData.description && { description: formData.description }),
          ...(formData.kill && { kill: true })
        }
      };
      handleUpdateWithFeedback(newPrograms);
      setShowAddForm(false);
      setFormData({ key: '', label: '', points: 10 as PointsLevel, type: 'bot', categories: [], description: '', kill: false });
    }
  };

  const handleEdit = (key: string) => {
    const prog = programs[key];
    setFormData({
      key,
      label: prog.label,
      points: prog.points,
      type: prog.type,
      categories: [...(prog.categories || [])],
      description: prog.description || '',
      kill: prog.kill || false
    });
    setEditingKey(key);
  };

  const handleUpdate = () => {
    if (editingKey && formData.label && formData.categories.length > 0) {
      const newPrograms = { ...programs };

      // If key changed, delete old and add new
      if (editingKey !== formData.key.toLowerCase()) {
        delete newPrograms[editingKey];
      }

      newPrograms[formData.key.toLowerCase()] = {
        label: formData.label,
        points: formData.points,
        type: formData.type,
        categories: formData.categories,
        ...(formData.description && { description: formData.description }),
        ...(formData.kill && { kill: true })
      };

      handleUpdateWithFeedback(newPrograms);
      setEditingKey(null);
      setFormData({ key: '', label: '', points: 10 as PointsLevel, type: 'bot', categories: [], description: '', kill: false });
    }
  };

  const handleToggleKill = async (key: string) => {
    const prog = programs[key];
    const newPrograms = { ...programs };
    newPrograms[key] = {
      ...prog,
      kill: !prog.kill
    };
    await handleUpdateWithFeedback(newPrograms);
  };

  const handleDelete = (key: string) => {
    if (confirm(`Delete ${programs[key].label} (${key})?`)) {
      const newPrograms = { ...programs };
      delete newPrograms[key];
      handleUpdateWithFeedback(newPrograms);
    }
  };

  const handleBulkUpdate = (field: 'points' | 'type', value: PointsLevel | string) => {
    if (selectedPrograms.size === 0) return;

    const newPrograms = { ...programs };
    selectedPrograms.forEach(key => {
      if (newPrograms[key]) {
        if (field === 'points') {
          newPrograms[key].points = value as PointsLevel;
        } else {
          newPrograms[key].type = value as string;
        }
      }
    });
    onUpdate(newPrograms);
    setSelectedPrograms(new Set());
  };

  const toggleProgramSelection = (key: string) => {
    const newSelection = new Set(selectedPrograms);
    if (newSelection.has(key)) {
      newSelection.delete(key);
    } else {
      newSelection.add(key);
    }
    setSelectedPrograms(newSelection);
  };

  const toggleAllSelection = () => {
    if (selectedPrograms.size === filteredPrograms.length) {
      setSelectedPrograms(new Set());
    } else {
      setSelectedPrograms(new Set(filteredPrograms.map(([key]) => key)));
    }
  };

  const handleResetToDefault = async () => {
    if (!confirm('Are you sure you want to reset all programs to default values? This will restore the original programs registry and remove any custom changes.')) {
      return;
    }

    const token = localStorage.getItem('adminToken');
    if (!token) {
      setSaveMessage({ type: 'error', text: 'Admin token required to reset configurations' });
      setTimeout(() => setSaveMessage(null), 5000);
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch('/api/configs/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ category: 'programs_registry' })
      });

      const result = await response.json();

      if (response.ok) {
        setSaveMessage({ type: 'success', text: 'Successfully reset to default values' });
        // Refresh the programs by calling onUpdate with the reset data
        // The parent component should refetch from the API
        setTimeout(() => {
          setSaveMessage(null);
          window.location.reload(); // Simple refresh to reload data
        }, 2000);
      } else {
        setSaveMessage({ type: 'error', text: result.error || 'Failed to reset configurations' });
        setTimeout(() => setSaveMessage(null), 5000);
      }
    } catch (error) {
      console.error('Reset error:', error);
      setSaveMessage({ type: 'error', text: 'Failed to reset configurations' });
      setTimeout(() => setSaveMessage(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateWithFeedback = useCallback(async (updatedPrograms: Record<string, Program>) => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Call the parent's onUpdate which handles the API call
      // It's now async, so we await it
      await onUpdate(updatedPrograms);

      // Show success message
      setSaveMessage({ type: 'success', text: 'Changes saved successfully' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Update error:', error);
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save changes'
      });
      setTimeout(() => setSaveMessage(null), 5000);
    } finally {
      setIsSaving(false);
    }
  }, [onUpdate]);

  return (
    <div className="space-y-6">
      {/* Save Status Messages */}
      {saveMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className={`p-4 rounded-lg flex items-center gap-3 ${saveMessage.type === 'success'
            ? 'bg-green-500/10 border border-green-500/20'
            : 'bg-red-500/10 border border-red-500/20'
            }`}
        >
          {saveMessage.type === 'success' ? (
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <span className={saveMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}>
            {saveMessage.text}
          </span>
        </motion.div>
      )}

      {/* Loading Indicator */}
      {isSaving && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>
          <span className="text-blue-400">Saving changes...</span>
        </div>
      )}

      {/* Header with search, category filter, and add button */}
      <div className="flex flex-col gap-4">
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
          <p className="text-yellow-400 text-xs flex items-center gap-2">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <strong>ToS Review Recommended:</strong> CoinPoker may need to review or update Terms of Service to explicitly permit process scanning and monitoring of running programs.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex-1 max-w-md">
            <div className="relative">
              <input
                type="text"
                placeholder="Search programs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 pl-10 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
              <svg className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <div className="text-sm text-slate-400">
              {Object.keys(programs).length} programs
            </div>
            <button
              onClick={handleResetToDefault}
              disabled={isSaving}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset to Default
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Program
            </button>
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 rounded-lg text-sm transition-colors ${selectedCategory === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
              }`}
          >
            All ({Object.keys(programs).length})
          </button>
          {allCategories.map(cat => {
            const count = Object.values(programs).filter(p => (p.categories || []).includes(cat)).length;
            const catDef = categoryDefinitions[cat];
            return (
              <Tooltip
                key={cat}
                content={catDef?.description || `Programs in the ${cat} category`}
                position="bottom"
                delay={200}
              >
                <button
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${selectedCategory === cat
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
                    }`}
                >
                  <span>{catDef?.name || cat} ({count})</span>
                  <span className="text-xs opacity-70">?</span>
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Bulk Actions */}
        {selectedPrograms.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
            <span className="text-indigo-400 text-sm font-medium">
              {selectedPrograms.size} selected
            </span>
            <select
              onChange={(e) => handleBulkUpdate('points', parseInt(e.target.value) as PointsLevel)}
              className="px-3 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
            >
              <option value="">Bulk Update Points</option>
              <option value="0">0 (INFO)</option>
              <option value="5">5 (WARN)</option>
              <option value="10">10 (ALERT)</option>
              <option value="15">15 (CRITICAL)</option>
            </select>
            <select
              onChange={(e) => handleBulkUpdate('type', e.target.value)}
              className="px-3 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
            >
              <option value="">Bulk Update Type</option>
              {typeOptions.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => setSelectedPrograms(new Set())}
              className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm"
            >
              Clear Selection
            </button>
          </div>
        )}
      </div>

      {/* Add Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-slate-800 rounded-lg p-4 border border-green-500/50"
          >
            <h3 className="text-lg font-semibold text-white mb-4">Add New Program</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Process Name (e.g., warbot.exe)</label>
                <input
                  type="text"
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase() })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  placeholder="program.exe"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Display Name</label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  placeholder="WarBot"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1 flex items-center gap-1.5">
                  Threat Level
                  <Tooltip
                    content="Points assigned to detected programs: 0 (INFO) = informational only, 5 (WARN) = suspicious tools, 10 (ALERT) = RTA tools/macros, 15 (CRITICAL) = known bots/high-risk automation. Higher points = higher threat score."
                    position="top"
                    delay={200}
                  >
                    <span className="text-xs text-slate-500 cursor-help">?</span>
                  </Tooltip>
                </label>
                <select
                  value={formData.points}
                  onChange={(e) => setFormData({ ...formData, points: parseInt(e.target.value) as PointsLevel })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="0">0 - INFO (no points)</option>
                  <option value="5">5 - WARN (suspicious)</option>
                  <option value="10">10 - ALERT (serious)</option>
                  <option value="15">15 - CRITICAL (highest)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  {typeOptions.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-slate-400 mb-1">Categories</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {allCategories.map(cat => (
                    <label key={cat} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.categories.includes(cat)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, categories: [...formData.categories, cat] });
                          } else {
                            setFormData({ ...formData, categories: formData.categories.filter(c => c !== cat) });
                          }
                        }}
                        className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-300">{categoryDefinitions[cat]?.name || cat}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-slate-400 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  placeholder="Optional description"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.kill}
                    onChange={(e) => setFormData({ ...formData, kill: e.target.checked })}
                    className="w-4 h-4 text-red-600 bg-slate-700 border-slate-600 rounded focus:ring-red-500"
                  />
                  <span className="text-sm text-slate-300">
                    Auto-kill this process when detected
                    <Tooltip
                      content="When enabled, this process will be automatically terminated when detected. Prevents the program from opening or will close CoinPoker client."
                      position="right"
                      delay={300}
                    >
                      <span className="text-xs text-slate-500 cursor-help ml-1">?</span>
                    </Tooltip>
                  </span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleAdd}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
              >
                Add Program
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({ key: '', label: '', points: 10 as PointsLevel, type: 'bot', categories: [], description: '', kill: false });
                }}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Programs Table */}
      <div className="bg-slate-800/50 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-700/50">
            <tr>
              <th className="px-4 py-3 text-left w-12">
                <input
                  type="checkbox"
                  checked={selectedPrograms.size === filteredPrograms.length && filteredPrograms.length > 0}
                  onChange={toggleAllSelection}
                  className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Process</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Label</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">Points</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Categories</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">
                <Tooltip
                  content="Auto-kill this process when detected. Prevents the program from opening or will close CoinPoker client."
                  position="top"
                  delay={300}
                >
                  <span className="cursor-help">Kill</span>
                </Tooltip>
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filteredPrograms.map(([key, prog]) => (
              <tr key={key} className={`hover:bg-slate-700/30 transition-colors ${selectedPrograms.has(key) ? 'bg-indigo-500/10' : ''}`}>
                {editingKey === key ? (
                  // Edit mode
                  <>
                    <td></td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={formData.key}
                        onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase() })}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm w-full"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={formData.label}
                        onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm w-full"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={formData.points}
                        onChange={(e) => setFormData({ ...formData, points: parseInt(e.target.value) as PointsLevel })}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                      >
                        <option value="0">0 (INFO)</option>
                        <option value="5">5 (WARN)</option>
                        <option value="10">10 (ALERT)</option>
                        <option value="15">15 (CRITICAL)</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm w-full"
                      >
                        {typeOptions.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        multiple
                        value={formData.categories}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, opt => opt.value);
                          setFormData({ ...formData, categories: selected });
                        }}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm w-full"
                        size={3}
                      >
                        {allCategories.map(cat => (
                          <option key={cat} value={cat}>{categoryDefinitions[cat]?.name || cat}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={formData.kill}
                        onChange={(e) => setFormData({ ...formData, kill: e.target.checked })}
                        className="w-4 h-4 text-red-600 bg-slate-700 border-slate-600 rounded focus:ring-red-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={handleUpdate}
                        className="text-green-400 hover:text-green-300 mr-2"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingKey(null);
                          setFormData({ key: '', label: '', points: 10 as PointsLevel, type: 'bot', categories: [], description: '', kill: false });
                        }}
                        className="text-slate-400 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  // View mode
                  <>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedPrograms.has(key)}
                        onChange={() => toggleProgramSelection(key)}
                        className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Tooltip
                        content={(() => {
                          const explanation = getProgramExplanation(key) || getProgramExplanation(prog.label);
                          if (explanation) {
                            let content = `${prog.label || key}\n\n${explanation}`;
                            if (prog.description) {
                              content += `\n\n⚠️ Prohibited Use: ${prog.description}`;
                            }
                            return content;
                          }
                          // Fallback to generic explanation based on type/category
                          const genericExplanation = getGenericExplanation(prog.type, prog.categories || []);
                          let content = `${prog.label || key}\n\n${genericExplanation}`;
                          if (prog.description) {
                            content += `\n\n⚠️ Prohibited Use: ${prog.description}`;
                          }
                          return content;
                        })()}
                        delay={1200}
                        position="right"
                      >
                        <span className="font-mono text-sm text-slate-300 cursor-help">{key}</span>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3">
                      <Tooltip
                        content={(() => {
                          const explanation = getProgramExplanation(key) || getProgramExplanation(prog.label);
                          if (explanation) {
                            let content = `${prog.label}\n\n${explanation}`;
                            if (prog.description) {
                              content += `\n\n⚠️ Prohibited Use: ${prog.description}`;
                            }
                            return content;
                          }
                          // Fallback to generic explanation based on type/category
                          const genericExplanation = getGenericExplanation(prog.type, prog.categories || []);
                          let content = `${prog.label}\n\n${genericExplanation}`;
                          if (prog.description) {
                            content += `\n\n⚠️ Prohibited Use: ${prog.description}`;
                          }
                          return content;
                        })()}
                        delay={1200}
                        position="right"
                      >
                        <span className="text-white font-medium cursor-help">{prog.label}</span>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${pointsColors[prog.points]}`}>
                        {prog.points} ({pointsLabels[prog.points]})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-sm">{prog.type}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(prog.categories || []).map(cat => (
                          <span key={cat} className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300">
                            {categoryDefinitions[cat]?.name || cat}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={prog.kill || false}
                        onChange={() => handleToggleKill(key)}
                        className="w-4 h-4 text-red-600 bg-slate-700 border-slate-600 rounded focus:ring-red-500 cursor-pointer"
                        title={prog.kill ? 'Auto-kill enabled' : 'Enable auto-kill'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleEdit(key)}
                        className="text-blue-400 hover:text-blue-300 mr-3"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(key)}
                        className="text-red-400 hover:text-red-300"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {filteredPrograms.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            {searchTerm || selectedCategory !== 'all'
              ? 'No programs found matching your filters'
              : 'No programs configured'}
          </div>
        )}
      </div>
    </div>
  );
}

