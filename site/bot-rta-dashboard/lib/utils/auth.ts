import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";

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
        const adminUser = process.env.ADMIN_USER || "admin";
        const adminPass = process.env.ADMIN_PASS || "admin";
        if (
          credentials?.username === adminUser &&
          credentials?.password === adminPass
        ) {
          return { id: "admin", name: adminUser };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthOptions;


