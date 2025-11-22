export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-300">404</h1>
        <p className="text-xl text-slate-400 mt-4">Page not found</p>
        <a href="/" className="text-blue-400 hover:text-blue-300 mt-6 inline-block">
          ← Back to home
        </a>
      </div>
    </div>
  );
}
