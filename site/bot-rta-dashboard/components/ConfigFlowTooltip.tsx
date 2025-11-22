"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ConfigFlowDiagram from "./ConfigFlowDiagram";

interface ConfigFlowTooltipProps {
  explanation: string;
  children: React.ReactNode;
  delay?: number;
  position?: "top" | "bottom" | "left" | "right";
}

export default function ConfigFlowTooltip({
  explanation,
  children,
  delay = 300,
  position = "bottom",
}: ConfigFlowTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      updateTooltipPosition();
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  const handleMouseMove = () => {
    if (isVisible) {
      updateTooltipPosition();
    }
  };

  const updateTooltipPosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      let x = 0;
      let y = 0;

      switch (position) {
        case "top":
          x = rect.left + rect.width / 2 + scrollX;
          y = rect.top + scrollY - 8;
          break;
        case "bottom":
          x = rect.left + rect.width / 2 + scrollX;
          y = rect.bottom + scrollY + 8;
          break;
        case "left":
          x = rect.left + scrollX - 8;
          y = rect.top + rect.height / 2 + scrollY;
          break;
        case "right":
          x = rect.right + scrollX + 8;
          y = rect.top + rect.height / 2 + scrollY;
          break;
      }

      setTooltipPosition({ x, y });
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        className="relative inline-block"
      >
        {children}
      </div>

      <AnimatePresence>
        {isVisible && (
          <motion.div
            ref={tooltipRef}
            initial={{
              opacity: 0,
              scale: 0.8,
              y:
                position === "top"
                  ? 10
                  : position === "bottom"
                  ? -10
                  : 0,
            }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.8,
              y:
                position === "top"
                  ? 10
                  : position === "bottom"
                  ? -10
                  : 0,
            }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed z-50"
            style={{
              left: `${tooltipPosition.x}px`,
              top: `${tooltipPosition.y}px`,
              transform: `translateX(${
                position === "left"
                  ? "-100%"
                  : position === "right"
                  ? "0%"
                  : "-50%"
              }) translateY(${
                position === "top"
                  ? "-100%"
                  : position === "bottom"
                  ? "0%"
                  : "-50%"
              })`,
              pointerEvents: "auto" as const,
            }}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
          >
            <div className="bg-slate-900/98 backdrop-blur-sm border border-slate-700 rounded-lg shadow-2xl max-w-md overflow-hidden">
              {/* Explanation Text */}
              <div className="px-4 py-3 border-b border-slate-700">
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                  {explanation}
                </p>
              </div>

              {/* Flow Diagram */}
              <div className="p-3 bg-slate-800/30">
                <ConfigFlowDiagram />
              </div>

              {/* Arrow */}
              <div
                className={`absolute w-2 h-2 bg-slate-900 border-slate-700 transform rotate-45 ${
                  position === "top"
                    ? "bottom-[-4px] left-1/2 -translate-x-1/2 border-r border-b"
                    : position === "bottom"
                    ? "top-[-4px] left-1/2 -translate-x-1/2 border-l border-t"
                    : position === "left"
                    ? "right-[-4px] top-1/2 -translate-y-1/2 border-r border-t"
                    : "left-[-4px] top-1/2 -translate-y-1/2 border-l border-b"
                }`}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

