import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// WebSocket endpoint for real-time updates
// Note: Next.js App Router doesn't natively support WebSockets
// This is a placeholder that returns upgrade instructions
export async function GET(req: NextRequest) {
  // Check if this is a WebSocket upgrade request
  const upgrade = req.headers.get('upgrade');

  if (upgrade === 'websocket') {
    return new Response('WebSocket upgrade required', {
      status: 426,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Content-Type': 'text/plain',
      },
    });
  }

  // Return WebSocket connection info for clients
  return new Response(JSON.stringify({
    message: 'WebSocket endpoint',
    info: 'For production, use a separate WebSocket server or Socket.io',
    alternatives: [
      'Use Server-Sent Events (SSE) via /api/stream',
      'Deploy a separate WebSocket server',
      'Use a service like Pusher or Ably',
    ],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
