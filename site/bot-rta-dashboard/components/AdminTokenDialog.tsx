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
  const [hasToken, setHasToken] = useState(false);

  // Check for token on client side only
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      setHasToken(!!localStorage.getItem('adminToken'));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError('Please enter an admin token');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      // Verify token by attempting to fetch configs with it
      const response = await fetch('/api/configs/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          category: 'test',
          config: {},
          test: true // Just test the auth
        })
      });

      if (response.status === 401) {
        setError('Invalid admin token');
        setIsVerifying(false);
        return;
      }

      // Save token to localStorage
      localStorage.setItem('adminToken', token);
      setHasToken(true);

      // Success
      onSuccess();
      onClose();
      setToken('');
    } catch (error) {
      setError('Failed to verify token');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setHasToken(false);
    onSuccess();
    onClose();
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
                {hasToken
                  ? 'You are currently logged in as an admin.'
                  : 'Enter your admin token to enable configuration editing.'}
              </p>

              {!hasToken ? (
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
                    />
                    {error && (
                      <p className="mt-2 text-sm text-red-400">{error}</p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={isVerifying || !token}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isVerifying ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Verifying...
                        </>
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
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                    >
                      Logout
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
                  Note: Admin token is stored locally in your browser and is required to modify detection configurations.
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
