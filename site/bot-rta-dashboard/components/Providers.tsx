"use client";

import { SessionProvider } from "next-auth/react";
import GlobalDidAgent from "./GlobalDidAgent";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <GlobalDidAgent />
    </SessionProvider>
  );
}
