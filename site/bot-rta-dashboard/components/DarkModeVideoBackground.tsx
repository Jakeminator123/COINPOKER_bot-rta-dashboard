"use client";

export function DarkModeVideoBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-[#030513]">
      {/* Animated liquid blobs */}
      <div className="absolute inset-0">
        {/* Large slow-moving blob 1 */}
        <div 
          className="absolute w-[800px] h-[800px] rounded-full blur-[120px] opacity-30 animate-blob-slow"
          style={{
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.6) 0%, rgba(139, 92, 246, 0) 70%)',
            top: '-20%',
            left: '-10%',
          }}
        />
        
        {/* Large slow-moving blob 2 */}
        <div 
          className="absolute w-[700px] h-[700px] rounded-full blur-[100px] opacity-25 animate-blob-slow-reverse"
          style={{
            background: 'radial-gradient(circle, rgba(236, 72, 153, 0.5) 0%, rgba(236, 72, 153, 0) 70%)',
            bottom: '-15%',
            right: '-5%',
            animationDelay: '-5s',
          }}
        />

        {/* Medium blob 1 */}
        <div 
          className="absolute w-[500px] h-[500px] rounded-full blur-[80px] opacity-20 animate-blob-medium"
          style={{
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.5) 0%, rgba(99, 102, 241, 0) 70%)',
            top: '30%',
            right: '20%',
            animationDelay: '-3s',
          }}
        />

        {/* Medium blob 2 */}
        <div 
          className="absolute w-[400px] h-[400px] rounded-full blur-[70px] opacity-25 animate-blob-medium-reverse"
          style={{
            background: 'radial-gradient(circle, rgba(167, 139, 250, 0.4) 0%, rgba(167, 139, 250, 0) 70%)',
            bottom: '20%',
            left: '15%',
            animationDelay: '-8s',
          }}
        />

        {/* Small accent blob */}
        <div 
          className="absolute w-[300px] h-[300px] rounded-full blur-[60px] opacity-30 animate-blob-small"
          style={{
            background: 'radial-gradient(circle, rgba(244, 114, 182, 0.4) 0%, rgba(244, 114, 182, 0) 70%)',
            top: '60%',
            left: '40%',
            animationDelay: '-2s',
          }}
        />
      </div>

      {/* Mesh gradient overlay */}
      <div className="absolute inset-0 opacity-40">
        <div 
          className="absolute inset-0 animate-gradient-shift"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 20% 40%, rgba(120, 119, 198, 0.15), transparent),
              radial-gradient(ellipse 60% 40% at 80% 60%, rgba(236, 72, 153, 0.1), transparent),
              radial-gradient(ellipse 50% 50% at 50% 50%, rgba(99, 102, 241, 0.1), transparent)
            `,
          }}
        />
      </div>

      {/* Subtle grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Vignette effect */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(3, 5, 19, 0.4) 100%)',
        }}
      />
    </div>
  );
}

