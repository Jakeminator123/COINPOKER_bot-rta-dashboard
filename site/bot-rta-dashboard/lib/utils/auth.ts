import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyManagedCredentials } from "@/lib/utils/admin-session";

export const authConfig = {
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials: { username?: string; password?: string } | undefined) {
        if (
          credentials?.username &&
          credentials?.password &&
          verifyManagedCredentials(credentials.username, credentials.password)
        ) {
          return { id: credentials.username, name: credentials.username };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthOptions;


