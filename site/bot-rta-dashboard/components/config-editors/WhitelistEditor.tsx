'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WhitelistEditorProps {
  programWhitelist: string[];
  websiteWhitelist: string[];
  onSaveProgramWhitelist: (programs: string[]) => Promise<void>;
  onSaveWebsiteWhitelist: (websites: string[]) => Promise<void>;
}

type TabType = 'programs' | 'websites';

export default function WhitelistEditor({
  programWhitelist,
  websiteWhitelist,
  onSaveProgramWhitelist,
  onSaveWebsiteWhitelist,
}: WhitelistEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('programs');
  const [newProgram, setNewProgram] = useState('');
  const [newWebsite, setNewWebsite] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [localProgramWhitelist, setLocalProgramWhitelist] = useState<string[]>(programWhitelist);
  const [localWebsiteWhitelist, setLocalWebsiteWhitelist] = useState<string[]>(websiteWhitelist);

  // Update local state when props change (e.g., after reset to default)
  useEffect(() => {
    setLocalProgramWhitelist(programWhitelist);
  }, [programWhitelist]);

  useEffect(() => {
    setLocalWebsiteWhitelist(websiteWhitelist);
  }, [websiteWhitelist]);

  const tabs: { id: TabType; label: string; icon: string; count: number }[] = [
    { id: 'programs', label: 'Program Whitelist', icon: '🖥️', count: localProgramWhitelist.length },
    { id: 'websites', label: 'Website Whitelist', icon: '🌐', count: localWebsiteWhitelist.length },
  ];

  const handleAddProgram = async () => {
    if (!newProgram.trim()) return;
    
    const programName = newProgram.trim().toLowerCase();
    
    // Validate - should look like a program name, not a website
    if (programName.includes('.com') || programName.includes('.org') || programName.includes('://')) {
      setMessage({ type: 'error', text: 'This looks like a website. Add it to Website Whitelist instead.' });
      return;
    }
    
    if (localProgramWhitelist.some(p => p.toLowerCase() === programName)) {
      setMessage({ type: 'error', text: 'Program already in whitelist' });
      return;
    }

    const updated = [...localProgramWhitelist, newProgram.trim()];
    setLocalProgramWhitelist(updated);
    setNewProgram('');
    
    setIsSaving(true);
    try {
      await onSaveProgramWhitelist(updated);
      setMessage({ type: 'success', text: 'Program added to whitelist' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' });
      setLocalProgramWhitelist(localProgramWhitelist); // Revert
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveProgram = async (program: string) => {
    const updated = localProgramWhitelist.filter(p => p !== program);
    setLocalProgramWhitelist(updated);
    
    setIsSaving(true);
    try {
      await onSaveProgramWhitelist(updated);
      setMessage({ type: 'success', text: 'Program removed from whitelist' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' });
      setLocalProgramWhitelist(localProgramWhitelist); // Revert
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddWebsite = async () => {
    if (!newWebsite.trim()) return;
    
    let domain = newWebsite.trim().toLowerCase();
    // Clean up URL to just domain
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    
    // Validate - should look like a website
    if (domain.endsWith('.exe') || !domain.includes('.')) {
      setMessage({ type: 'error', text: 'This looks like a program. Add it to Program Whitelist instead.' });
      return;
    }
    
    if (localWebsiteWhitelist.some(w => w.toLowerCase() === domain)) {
      setMessage({ type: 'error', text: 'Website already in whitelist' });
      return;
    }

    const updated = [...localWebsiteWhitelist, domain];
    setLocalWebsiteWhitelist(updated);
    setNewWebsite('');
    
    setIsSaving(true);
    try {
      await onSaveWebsiteWhitelist(updated);
      setMessage({ type: 'success', text: 'Website added to whitelist' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' });
      setLocalWebsiteWhitelist(localWebsiteWhitelist); // Revert
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveWebsite = async (website: string) => {
    const updated = localWebsiteWhitelist.filter(w => w !== website);
    setLocalWebsiteWhitelist(updated);
    
    setIsSaving(true);
    try {
      await onSaveWebsiteWhitelist(updated);
      setMessage({ type: 'success', text: 'Website removed from whitelist' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' });
      setLocalWebsiteWhitelist(localWebsiteWhitelist); // Revert
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <h3 className="text-green-400 font-semibold mb-1">Whitelist / Ignore List</h3>
            <p className="text-sm text-slate-300">
              Items in these lists will <strong>never trigger alerts</strong>. Use this for false positives 
              or legitimate programs/websites you don&apos;t want flagged.
            </p>
          </div>
        </div>
      </div>

      {/* Message */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-3 rounded-lg text-sm ${
              message.type === 'success' 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {message.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-t-lg font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-green-500/20 text-green-400 border-b-2 border-green-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[300px]">
        {activeTab === 'programs' && (
          <div className="space-y-4">
            {/* Add Program */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newProgram}
                onChange={(e) => setNewProgram(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddProgram()}
                placeholder="e.g., AutoHotkey, Python, MyApp.exe"
                className="flex-1 px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-green-500 focus:outline-none"
                disabled={isSaving}
              />
              <button
                onClick={handleAddProgram}
                disabled={isSaving || !newProgram.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
              >
                Add
              </button>
            </div>

            {/* Program List */}
            <div className="space-y-2">
              {localProgramWhitelist.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <span className="text-4xl mb-2 block">📋</span>
                  <p>No programs in whitelist</p>
                  <p className="text-xs mt-1">Add programs that should never trigger alerts</p>
                </div>
              ) : (
                localProgramWhitelist.map((program) => (
                  <motion.div
                    key={program}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 bg-slate-800/50 border border-slate-700 rounded-lg group hover:border-slate-600"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-green-400">✓</span>
                      <span className="text-white font-mono">{program}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveProgram(program)}
                      disabled={isSaving}
                      className="px-3 py-1 text-red-400 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-all"
                    >
                      Remove
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'websites' && (
          <div className="space-y-4">
            {/* Add Website */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newWebsite}
                onChange={(e) => setNewWebsite(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddWebsite()}
                placeholder="e.g., example.com, mysite.org"
                className="flex-1 px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-green-500 focus:outline-none"
                disabled={isSaving}
              />
              <button
                onClick={handleAddWebsite}
                disabled={isSaving || !newWebsite.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
              >
                Add
              </button>
            </div>

            {/* Website List */}
            <div className="space-y-2">
              {localWebsiteWhitelist.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <span className="text-4xl mb-2 block">🌐</span>
                  <p>No websites in whitelist</p>
                  <p className="text-xs mt-1">Add domains that should never trigger alerts</p>
                </div>
              ) : (
                localWebsiteWhitelist.map((website) => (
                  <motion.div
                    key={website}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 bg-slate-800/50 border border-slate-700 rounded-lg group hover:border-slate-600"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-green-400">✓</span>
                      <span className="text-white">{website}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveWebsite(website)}
                      disabled={isSaving}
                      className="px-3 py-1 text-red-400 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-all"
                    >
                      Remove
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

