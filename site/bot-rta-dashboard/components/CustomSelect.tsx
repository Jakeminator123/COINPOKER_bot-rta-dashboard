"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  label?: string;
  id?: string;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  className = "",
  label,
  id,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update dropdown position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // Close on scroll
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = () => setIsOpen(false);
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  const dropdownContent = isOpen && typeof document !== "undefined" ? createPortal(
    <div 
      className="fixed bg-slate-900/98 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl max-h-60 overflow-auto animate-fade-in"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        zIndex: 99999,
      }}
    >
      <div className="py-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
              setIsOpen(false);
            }}
            className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between ${
              option.value === value
                ? "bg-indigo-500/20 text-white"
                : "text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>{option.label}</span>
            {option.value === value && (
              <svg
                className="w-4 h-4 text-indigo-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative min-w-[200px]" ref={containerRef}>
      {label && (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      )}
      <button
        ref={buttonRef}
        type="button"
        id={id}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full bg-white/5 text-white rounded-lg px-4 py-2 border border-white/10 focus:border-indigo-500 focus:outline-none hover:bg-white/10 transition-colors text-left flex items-center justify-between ${className}`}
      >
        <span className="truncate text-sm">
          {selectedOption?.label || value}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {dropdownContent}
    </div>
  );
}

