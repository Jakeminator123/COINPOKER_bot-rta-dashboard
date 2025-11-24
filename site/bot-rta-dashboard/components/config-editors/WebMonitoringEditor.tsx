'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from '@/lib/utils/hooks';

type StatusLevel = 'INFO' | 'WARN' | 'ALERT' | 'CRITICAL';

interface WebPattern {
  label: string;
  status: StatusLevel;
  description: string;
}

interface PortConfig {
  label: string;
  description: string;
}

interface CommunicationApp {
  label: string;
  status: StatusLevel;
  points: number;
  description: string;
}

interface WebMonitoringConfig {
  browser_min_repeat: number;
  dns_alert_cooldown: number;
  interval_s: number;
  rta_websites: Record<string, WebPattern>;
  browser_keywords: string[];
  suspicious_domains: Record<string, WebPattern>;
  communication_patterns: Record<string, WebPattern>;
  remote_access_patterns: Record<string, WebPattern>;
}

interface TrafficMonitoringConfig {
  interval_s: number;
  alert_cooldown: number;
  connections_cache_ttl: number;
  suspicious_ports: Record<string, PortConfig>;
  communication_apps: Record<string, CommunicationApp>;
}

interface TelegramDetectionConfig {
  cidr_fetch_interval: number;
  alert_cooldown: number;
  poker_fg_window: number;
  browser_names: string[];
  official_telegram: string[];
  tdlib_hints: string[];
}

interface NetworkConfig {
  _points_mapping: Record<string, { status: string; description: string }>;
  telegram_detection: TelegramDetectionConfig;
  web_monitoring: WebMonitoringConfig;
  traffic_monitoring: TrafficMonitoringConfig;
}

interface WebMonitoringEditorProps {
  config: NetworkConfig;
  onSave: (updates: NetworkConfig) => Promise<void>;
}

type TabType = 'rta_websites' | 'suspicious_domains' | 'communication' | 'remote_access' | 'traffic' | 'telegram' | 'settings';

export default function WebMonitoringEditor({ config, onSave }: WebMonitoringEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('rta_websites');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state for patterns
  const [formData, setFormData] = useState({
    key: '',
    label: '',
    status: 'ALERT' as StatusLevel,
    description: ''
  });

  // Form state for keywords
  const [newKeyword, setNewKeyword] = useState('');

  // Form state for ports
  const [portFormData, setPortFormData] = useState({
    port: '',
    label: '',
    description: ''
  });

  const statusColors: Record<StatusLevel, string> = {
    INFO: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    WARN: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    ALERT: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
    CRITICAL: 'text-red-500 bg-red-600/10 border-red-500/30'
  };

  const tabs: { id: TabType; label: string; icon: string; description: string }[] = [
    { id: 'rta_websites', label: 'RTA Websites', icon: '🎯', description: 'Real-time assistance websites' },
    { id: 'suspicious_domains', label: 'Suspicious Domains', icon: '🔗', description: 'Tunnels, Tor, proxies' },
    { id: 'communication', label: 'Communication', icon: '💬', description: 'Telegram, Discord patterns' },
    { id: 'remote_access', label: 'Remote Access', icon: '🖥️', description: 'TeamViewer, AnyDesk, etc.' },
    { id: 'traffic', label: 'Traffic/Ports', icon: '📡', description: 'Suspicious ports and apps' },
    { id: 'telegram', label: 'Telegram Detection', icon: '📱', description: 'Telegram IP detection settings' },
    { id: 'settings', label: 'Timing Settings', icon: '⚙️', description: 'Cooldowns and intervals' }
  ];

  const handleSaveWithFeedback = async (newConfig: NetworkConfig) => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await onSave(newConfig);
      setSaveMessage({ type: 'success', text: 'Configuration saved successfully' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      setSaveMessage({ type: 'error', text: 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  // Get patterns based on active tab
  const getCurrentPatterns = (): Record<string, WebPattern> => {
    switch (activeTab) {
      case 'rta_websites':
        return config.web_monitoring?.rta_websites || {};
      case 'suspicious_domains':
        return config.web_monitoring?.suspicious_domains || {};
      case 'communication':
        return config.web_monitoring?.communication_patterns || {};
      case 'remote_access':
        return config.web_monitoring?.remote_access_patterns || {};
      default:
        return {};
    }
  };

  // Filter patterns based on search
  const filteredPatterns = useMemo(() => {
    const patterns = getCurrentPatterns();
    if (!debouncedSearchTerm) return Object.entries(patterns);
    
    return Object.entries(patterns).filter(([key, pattern]) => 
      key.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      pattern.label.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      pattern.description.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    );
  }, [activeTab, config, debouncedSearchTerm]);

  // Handle pattern operations
  const handleAddPattern = () => {
    if (!formData.key || !formData.label) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    const patternKey = activeTab === 'rta_websites' ? 'rta_websites' :
                       activeTab === 'suspicious_domains' ? 'suspicious_domains' :
                       activeTab === 'communication' ? 'communication_patterns' :
                       'remote_access_patterns';

    if (!newConfig.web_monitoring[patternKey]) {
      newConfig.web_monitoring[patternKey] = {};
    }

    newConfig.web_monitoring[patternKey][formData.key.toLowerCase()] = {
      label: formData.label,
      status: formData.status,
      description: formData.description
    };

    handleSaveWithFeedback(newConfig);
    setShowAddForm(false);
    setFormData({ key: '', label: '', status: 'ALERT', description: '' });
  };

  const handleUpdatePattern = () => {
    if (!editingKey || !formData.label) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    const patternKey = activeTab === 'rta_websites' ? 'rta_websites' :
                       activeTab === 'suspicious_domains' ? 'suspicious_domains' :
                       activeTab === 'communication' ? 'communication_patterns' :
                       'remote_access_patterns';

    // Delete old key if changed
    if (editingKey !== formData.key.toLowerCase()) {
      delete newConfig.web_monitoring[patternKey][editingKey];
    }

    newConfig.web_monitoring[patternKey][formData.key.toLowerCase()] = {
      label: formData.label,
      status: formData.status,
      description: formData.description
    };

    handleSaveWithFeedback(newConfig);
    setEditingKey(null);
    setFormData({ key: '', label: '', status: 'ALERT', description: '' });
  };

  const handleDeletePattern = (key: string) => {
    const patterns = getCurrentPatterns();
    if (!confirm(`Delete "${patterns[key]?.label || key}"?`)) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    const patternKey = activeTab === 'rta_websites' ? 'rta_websites' :
                       activeTab === 'suspicious_domains' ? 'suspicious_domains' :
                       activeTab === 'communication' ? 'communication_patterns' :
                       'remote_access_patterns';

    delete newConfig.web_monitoring[patternKey][key];
    handleSaveWithFeedback(newConfig);
  };

  const handleEditPattern = (key: string) => {
    const patterns = getCurrentPatterns();
    const pattern = patterns[key];
    setFormData({
      key,
      label: pattern.label,
      status: pattern.status,
      description: pattern.description
    });
    setEditingKey(key);
  };

  // Handle keyword operations
  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    if (!newConfig.web_monitoring.browser_keywords) {
      newConfig.web_monitoring.browser_keywords = [];
    }
    
    if (!newConfig.web_monitoring.browser_keywords.includes(newKeyword.toLowerCase())) {
      newConfig.web_monitoring.browser_keywords.push(newKeyword.toLowerCase());
      handleSaveWithFeedback(newConfig);
    }
    setNewKeyword('');
  };

  const handleDeleteKeyword = (keyword: string) => {
    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    newConfig.web_monitoring.browser_keywords = newConfig.web_monitoring.browser_keywords.filter(k => k !== keyword);
    handleSaveWithFeedback(newConfig);
  };

  // Handle port operations
  const handleAddPort = () => {
    if (!portFormData.port || !portFormData.label) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    if (!newConfig.traffic_monitoring.suspicious_ports) {
      newConfig.traffic_monitoring.suspicious_ports = {};
    }

    newConfig.traffic_monitoring.suspicious_ports[portFormData.port] = {
      label: portFormData.label,
      description: portFormData.description
    };

    handleSaveWithFeedback(newConfig);
    setPortFormData({ port: '', label: '', description: '' });
  };

  const handleDeletePort = (port: string) => {
    if (!confirm(`Delete port ${port}?`)) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    delete newConfig.traffic_monitoring.suspicious_ports[port];
    handleSaveWithFeedback(newConfig);
  };

  // Handle timing settings
  const handleTimingChange = (section: 'web_monitoring' | 'traffic_monitoring' | 'telegram_detection', key: string, value: number) => {
    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    (newConfig[section] as any)[key] = value;
    handleSaveWithFeedback(newConfig);
  };

  // Render pattern list (for RTA, suspicious domains, communication, remote access)
  const renderPatternList = () => (
    <div className="space-y-4">
      {/* Search and Add */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search patterns..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <span>+</span> Add Pattern
        </button>
      </div>

      {/* Add/Edit Form */}
      <AnimatePresence>
        {(showAddForm || editingKey) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-4"
          >
            <h4 className="text-slate-200 font-medium">{editingKey ? 'Edit Pattern' : 'Add New Pattern'}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Pattern Key (domain/keyword)</label>
                <input
                  type="text"
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                  placeholder="e.g., gtowizard.com"
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Display Label</label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g., GTO Wizard"
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Severity Level</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as StatusLevel })}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="INFO">INFO</option>
                  <option value="WARN">WARN</option>
                  <option value="ALERT">ALERT</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What this pattern detects"
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setEditingKey(null);
                  setFormData({ key: '', label: '', status: 'ALERT', description: '' });
                }}
                className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingKey ? handleUpdatePattern : handleAddPattern}
                disabled={!formData.key || !formData.label}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
              >
                {editingKey ? 'Update' : 'Add'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pattern List */}
      <div className="space-y-2">
        {filteredPatterns.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            {debouncedSearchTerm ? 'No patterns match your search' : 'No patterns configured'}
          </div>
        ) : (
          filteredPatterns.map(([key, pattern]) => (
            <motion.div
              key={key}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between p-3 bg-slate-800/30 border border-slate-700/50 rounded-lg hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs font-medium border ${statusColors[pattern.status]}`}>
                  {pattern.status}
                </span>
                <div>
                  <div className="text-slate-200 font-medium">{pattern.label}</div>
                  <div className="text-sm text-slate-500">{key}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-400 max-w-xs truncate">{pattern.description}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditPattern(key)}
                    className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDeletePattern(key)}
                    className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Browser Keywords Section (only for RTA websites tab) */}
      {activeTab === 'rta_websites' && (
        <div className="mt-6 pt-6 border-t border-slate-700">
          <h4 className="text-slate-200 font-medium mb-3">Browser Title Keywords</h4>
          <p className="text-sm text-slate-400 mb-4">
            These keywords are searched in browser window titles to detect RTA tools
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
              placeholder="Add keyword..."
              className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleAddKeyword}
              disabled={!newKeyword.trim()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded transition-colors"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(config.web_monitoring?.browser_keywords || []).map((keyword) => (
              <span
                key={keyword}
                className="inline-flex items-center gap-1 px-3 py-1 bg-slate-800/50 border border-slate-700 rounded-full text-sm text-slate-300"
              >
                {keyword}
                <button
                  onClick={() => handleDeleteKeyword(keyword)}
                  className="text-slate-500 hover:text-red-400 ml-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Render traffic/ports tab
  const renderTrafficTab = () => (
    <div className="space-y-6">
      {/* Suspicious Ports */}
      <div>
        <h4 className="text-slate-200 font-medium mb-3">Suspicious Ports</h4>
        <p className="text-sm text-slate-400 mb-4">
          Network ports that may indicate remote access or streaming
        </p>
        
        {/* Add Port Form */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={portFormData.port}
            onChange={(e) => setPortFormData({ ...portFormData, port: e.target.value })}
            placeholder="Port (e.g., 3389)"
            className="w-24 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={portFormData.label}
            onChange={(e) => setPortFormData({ ...portFormData, label: e.target.value })}
            placeholder="Label (e.g., RDP)"
            className="w-32 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={portFormData.description}
            onChange={(e) => setPortFormData({ ...portFormData, description: e.target.value })}
            placeholder="Description"
            className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
          <button
            onClick={handleAddPort}
            disabled={!portFormData.port || !portFormData.label}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded transition-colors"
          >
            Add
          </button>
        </div>

        {/* Port List */}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(config.traffic_monitoring?.suspicious_ports || {}).map(([port, info]) => (
            <div
              key={port}
              className="flex items-center justify-between p-3 bg-slate-800/30 border border-slate-700/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-cyan-400">{port}</span>
                <span className="text-slate-200">{info.label}</span>
                <span className="text-sm text-slate-500">{info.description}</span>
              </div>
              <button
                onClick={() => handleDeletePort(port)}
                className="p-1 text-slate-400 hover:text-red-400 transition-colors"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Communication Apps */}
      <div className="pt-6 border-t border-slate-700">
        <h4 className="text-slate-200 font-medium mb-3">Communication Apps</h4>
        <p className="text-sm text-slate-400 mb-4">
          Apps monitored for network activity during poker sessions
        </p>
        <div className="space-y-2">
          {Object.entries(config.traffic_monitoring?.communication_apps || {}).map(([exe, app]) => (
            <div
              key={exe}
              className="flex items-center justify-between p-3 bg-slate-800/30 border border-slate-700/50 rounded-lg"
            >
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs font-medium border ${statusColors[app.status]}`}>
                  {app.status}
                </span>
                <div>
                  <span className="text-slate-200">{app.label}</span>
                  <span className="text-sm text-slate-500 ml-2">({exe})</span>
                </div>
              </div>
              <span className="text-sm text-slate-400">{app.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Render Telegram detection tab
  const renderTelegramTab = () => (
    <div className="space-y-6">
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
        <h4 className="text-slate-200 font-medium mb-2">How Telegram Detection Works</h4>
        <p className="text-sm text-slate-400">
          The scanner detects active connections to Telegram IP ranges when CoinPoker is running.
          This helps identify potential bot control channels being used during poker sessions.
        </p>
      </div>

      {/* Official Telegram Apps */}
      <div>
        <h4 className="text-slate-200 font-medium mb-3">Official Telegram Apps</h4>
        <p className="text-sm text-slate-400 mb-4">
          These are recognized as official Telegram clients (lower severity)
        </p>
        <div className="flex flex-wrap gap-2">
          {(config.telegram_detection?.official_telegram || []).map((app) => (
            <span
              key={app}
              className="px-3 py-1 bg-green-500/10 border border-green-500/30 rounded-full text-sm text-green-400"
            >
              {app}
            </span>
          ))}
        </div>
      </div>

      {/* TDLib Hints */}
      <div>
        <h4 className="text-slate-200 font-medium mb-3">TDLib Detection</h4>
        <p className="text-sm text-slate-400 mb-4">
          Processes loading these libraries are flagged as custom Telegram clients (higher severity)
        </p>
        <div className="flex flex-wrap gap-2">
          {(config.telegram_detection?.tdlib_hints || []).map((hint) => (
            <span
              key={hint}
              className="px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-sm text-red-400"
            >
              {hint}
            </span>
          ))}
        </div>
      </div>

      {/* Browser Names */}
      <div>
        <h4 className="text-slate-200 font-medium mb-3">Monitored Browsers</h4>
        <p className="text-sm text-slate-400 mb-4">
          Browser processes checked for Telegram web connections
        </p>
        <div className="flex flex-wrap gap-2">
          {(config.telegram_detection?.browser_names || []).map((browser) => (
            <span
              key={browser}
              className="px-3 py-1 bg-slate-700/50 border border-slate-600 rounded-full text-sm text-slate-300"
            >
              {browser}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  // Render timing settings tab
  const renderSettingsTab = () => (
    <div className="space-y-6">
      {/* Web Monitoring Settings */}
      <div>
        <h4 className="text-slate-200 font-medium mb-4">Web Monitoring</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">Browser Title Repeat Cooldown (seconds)</label>
            <input
              type="number"
              value={config.web_monitoring?.browser_min_repeat || 60}
              onChange={(e) => handleTimingChange('web_monitoring', 'browser_min_repeat', parseInt(e.target.value) || 60)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">Minimum time between repeated browser title alerts</p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">DNS Alert Cooldown (seconds)</label>
            <input
              type="number"
              value={config.web_monitoring?.dns_alert_cooldown || 120}
              onChange={(e) => handleTimingChange('web_monitoring', 'dns_alert_cooldown', parseInt(e.target.value) || 120)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">Minimum time between DNS lookup alerts</p>
          </div>
        </div>
      </div>

      {/* Traffic Monitoring Settings */}
      <div>
        <h4 className="text-slate-200 font-medium mb-4">Traffic Monitoring</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">Scan Interval (seconds)</label>
            <input
              type="number"
              value={config.traffic_monitoring?.interval_s || 10}
              onChange={(e) => handleTimingChange('traffic_monitoring', 'interval_s', parseInt(e.target.value) || 10)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">How often to scan network connections</p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">Alert Cooldown (seconds)</label>
            <input
              type="number"
              value={config.traffic_monitoring?.alert_cooldown || 30}
              onChange={(e) => handleTimingChange('traffic_monitoring', 'alert_cooldown', parseInt(e.target.value) || 30)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">Minimum time between traffic alerts</p>
          </div>
        </div>
      </div>

      {/* Telegram Detection Settings */}
      <div>
        <h4 className="text-slate-200 font-medium mb-4">Telegram Detection</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">CIDR Fetch Interval (seconds)</label>
            <input
              type="number"
              value={config.telegram_detection?.cidr_fetch_interval || 3600}
              onChange={(e) => handleTimingChange('telegram_detection', 'cidr_fetch_interval', parseInt(e.target.value) || 3600)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">How often to refresh Telegram IP ranges</p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">Alert Cooldown (seconds)</label>
            <input
              type="number"
              value={config.telegram_detection?.alert_cooldown || 120}
              onChange={(e) => handleTimingChange('telegram_detection', 'alert_cooldown', parseInt(e.target.value) || 120)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">Minimum time between Telegram alerts</p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-sm text-slate-400 mb-2">Poker Foreground Window (seconds)</label>
            <input
              type="number"
              value={config.telegram_detection?.poker_fg_window || 15}
              onChange={(e) => handleTimingChange('telegram_detection', 'poker_fg_window', parseInt(e.target.value) || 15)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">Grace period after poker loses focus</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Save Message */}
      <AnimatePresence>
        {saveMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-3 rounded-lg ${
              saveMessage.type === 'success' 
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}
          >
            {saveMessage.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSearchTerm('');
              setShowAddForm(false);
              setEditingKey(null);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
            title={tab.description}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Description */}
      <div className="text-sm text-slate-400">
        {tabs.find(t => t.id === activeTab)?.description}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {(activeTab === 'rta_websites' || activeTab === 'suspicious_domains' || 
          activeTab === 'communication' || activeTab === 'remote_access') && renderPatternList()}
        {activeTab === 'traffic' && renderTrafficTab()}
        {activeTab === 'telegram' && renderTelegramTab()}
        {activeTab === 'settings' && renderSettingsTab()}
      </div>

      {/* Saving Indicator */}
      {isSaving && (
        <div className="fixed bottom-4 right-4 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-slate-300 shadow-lg">
          Saving...
        </div>
      )}
    </div>
  );
}


