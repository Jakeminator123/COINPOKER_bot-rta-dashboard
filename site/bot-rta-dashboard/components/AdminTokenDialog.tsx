'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AdminTokenDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AdminTokenDialog({ isOpen, onClose, onSuccess }: AdminTokenDialogProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSyncingSession, setIsSyncingSession] = useState(true);

  const refreshSessionState = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    setIsSyncingSession(true);
    try {
      const storedSession = localStorage.getItem('adminSessionId');
      setSessionId(storedSession);
      if (!storedSession) {
        setHasSession(false);
        return;
      }
      const response = await fetch('/api/admin/session', {
        headers: { 'x-admin-session': storedSession },
      });
      const payload = await response.json();
      const active = response.ok && payload?.data?.isAdmin;
      if (!active) {
        localStorage.removeItem('adminSessionId');
        setSessionId(null);
      }
      setHasSession(Boolean(active));
    } catch {
      setHasSession(false);
    } finally {
      setIsSyncingSession(false);
    }
  }, []);

  React.useEffect(() => {
    refreshSessionState();
  }, [refreshSessionState]);

  React.useEffect(() => {
    if (isOpen) {
      refreshSessionState();
    }
  }, [isOpen, refreshSessionState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError('Please enter an admin token');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.data?.sessionId) {
        setError(payload?.error || 'Invalid admin token');
        return;
      }

      localStorage.setItem('adminToken', token);
      localStorage.setItem('adminSessionId', payload.data.sessionId);
      setSessionId(payload.data.sessionId);
      setHasSession(true);
      setToken('');
      onSuccess();
      onClose();
    } catch (error) {
      setError('Failed to verify token');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const headers: Record<string, string> = {};
      if (sessionId) {
        headers['x-admin-session'] = sessionId;
      }
      await fetch('/api/admin/session', {
        method: 'DELETE',
        headers,
      });
    } catch {
      // Ignore logout errors
    } finally {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminSessionId');
      setSessionId(null);
      setHasSession(false);
      setIsLoggingOut(false);
      onSuccess();
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md p-6">
              <h2 className="text-2xl font-bold text-white mb-2">Admin Access</h2>
              <p className="text-slate-400 text-sm mb-6">
                {hasSession
                  ? 'Admin session is active — configuration editing is unlocked.'
                  : 'Enter your admin token to unlock the full Settings page. Without it, everything stays read-only.'}
              </p>

              {!hasSession ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Admin Token
                    </label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value);
                        setError('');
                      }}
                      placeholder="Enter admin token"
                      className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                      autoComplete="new-password"
                      autoFocus
                      disabled={isVerifying || isSyncingSession}
                    />
                    {error && (
                      <p className="mt-2 text-sm text-red-400">{error}</p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={isVerifying || !token || isSyncingSession}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isVerifying ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Verifying...
                        </>
                      ) : isSyncingSession ? (
                        'Syncing...'
                      ) : (
                        'Login'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-green-400">Admin access enabled</span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isLoggingOut ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Logging out...
                        </>
                      ) : (
                        'Logout'
                      )}
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-slate-700">
                <p className="text-xs text-slate-500">
                  Note: The admin token and session identifier stay in your browser only and are required for any configuration changes.
                </p>
                <div className="mt-2 p-2 bg-slate-900/50 rounded text-xs text-slate-400">
                  <strong>Default admin token:</strong> admin-secret-2024
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
