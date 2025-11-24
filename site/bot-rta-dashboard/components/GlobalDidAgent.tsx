"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import DidAgentWidget from "./DidAgentWidget";

const FALLBACK_AGENT_URL =
  "https://studio.d-id.com/agents/share?id=v2_agt_JJZwZKuY&utm_source=copy&key=WjI5dloyeGxMVzloZFhSb01ud3hNVFV5TnpnMU56UXpORE0yTnpFMU9UUTVPRFU2VkZGclUxSTNTVU54V0hwdFpIZzNOSGxOVkhKMA==";

export default function GlobalDidAgent() {
  const { status } = useSession();

  const agentUrl = useMemo(
    () => process.env.NEXT_PUBLIC_DID_AGENT_URL || FALLBACK_AGENT_URL,
    []
  );

  if (status !== "authenticated") {
    return null;
  }

  if (!agentUrl) {
    return null;
  }

  return <DidAgentWidget agentUrl={agentUrl} title="D-ID Copilot" />;
}

