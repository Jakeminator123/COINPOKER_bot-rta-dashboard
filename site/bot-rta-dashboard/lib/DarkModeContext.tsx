"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface DarkModeContextType {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const DarkModeContext = createContext<DarkModeContextType | undefined>(undefined);

export function DarkModeProvider({ children }: { children: ReactNode }) {
  // Default to dark mode (true)
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Persist to localStorage - dark mode is default unless explicitly set to false
  useEffect(() => {
    const saved = localStorage.getItem("dashboard-dark-mode");
    // Only switch to light mode if explicitly set to "false"
    if (saved === "false") {
      setIsDarkMode(false);
    } else {
      // Default to dark mode, save preference if not set
      setIsDarkMode(true);
      if (saved === null) {
        localStorage.setItem("dashboard-dark-mode", "true");
      }
    }
    setIsHydrated(true);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const newValue = !prev;
      localStorage.setItem("dashboard-dark-mode", String(newValue));
      // Update HTML element class for global dark mode
      if (typeof document !== 'undefined') {
        const html = document.documentElement;
        if (newValue) {
          html.classList.add('dark');
        } else {
          html.classList.remove('dark');
        }
      }
      return newValue;
    });
  };

  // Update HTML element when dark mode changes or on mount
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const html = document.documentElement;
      if (isDarkMode) {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
    }
  }, [isDarkMode]);

  return (
    <DarkModeContext.Provider value={{ isDarkMode, toggleDarkMode }}>
      {children}
    </DarkModeContext.Provider>
  );
}

export function useDarkMode() {
  const context = useContext(DarkModeContext);
  if (context === undefined) {
    throw new Error("useDarkMode must be used within a DarkModeProvider");
  }
  return context;
}


