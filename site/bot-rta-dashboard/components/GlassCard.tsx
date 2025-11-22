"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  gradient?: boolean;
  title?: string;
}

export function GlassCard({ children, className = "", hover = true, glow = false, gradient = false, title }: GlassCardProps) {
  return (
    <motion.div
      className={`relative ${className}`}
      whileHover={hover ? { scale: 1.01, y: -1 } : {}}
      transition={{ duration: 0.3 }}
      title={title}
    >
      {/* Glow Effect */}
      {glow && (
        <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl opacity-15 blur-lg" />
      )}
      
      {/* Glass Card */}
      <div className={`
        relative 
        backdrop-blur-md 
        bg-white/3 
        border 
        border-white/10 
        rounded-xl 
        shadow-xl
        ${gradient ? 'bg-gradient-to-br from-white/10 to-white/5' : ''}
      `}>
        {/* Top Reflection */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        
        {/* Content */}
        {children}
      </div>
    </motion.div>
  );
}

export function FeatureCard({ 
  icon, 
  title, 
  description, 
  isActive = false 
}: { 
  icon: ReactNode; 
  title: string; 
  description: string;
  isActive?: boolean;
}) {
  return (
    <GlassCard 
      className="p-6" 
      glow={isActive}
      gradient={true}
    >
      <div className="flex items-start gap-4">
        {/* Icon Container */}
        <motion.div 
          className={`
            p-3 rounded-xl 
            ${isActive 
              ? 'bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border-indigo-500/30' 
              : 'bg-white/5 border-white/10'
            }
            border backdrop-blur-xl
          `}
          animate={isActive ? { rotate: [0, 2, -2, 0] } : {}}
          transition={{ duration: 1 }}
        >
          {icon}
        </motion.div>
        
        {/* Content */}
        <div className="flex-1">
          <h3 className={`font-semibold text-lg ${isActive ? 'text-white' : 'text-white/90'}`}>
            {title}
          </h3>
          <p className="text-white/60 text-sm mt-1">
            {description}
          </p>
        </div>
        
        {/* Status Indicator */}
        {isActive && (
          <motion.div
            className="w-2 h-2 bg-green-500 rounded-full"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        )}
      </div>
    </GlassCard>
  );
}
