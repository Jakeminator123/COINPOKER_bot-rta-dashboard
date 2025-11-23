'use client';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  message?: string;
}

export function LoadingSpinner({ 
  size = 'md', 
  className = '', 
  message 
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-2',
    lg: 'h-12 w-12 border-3'
  };

  return (
    <div className={`flex flex-col justify-center items-center p-8 ${className}`}>
      <div 
        className={`animate-spin rounded-full border-b-cyan-500 border-t-transparent border-l-transparent border-r-transparent ${sizeClasses[size]}`}
        role="status"
        aria-label="Loading"
      />
      {message && (
        <p className="mt-4 text-sm text-slate-400">{message}</p>
      )}
    </div>
  );
}

// Export a full-page loader for initial page loads
export function FullPageLoader() {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
      <LoadingSpinner size="lg" message="Loading..." />
    </div>
  );
}
