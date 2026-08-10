"use client";

import { useEffect, useState } from "react";
import { playerFetch } from "@/lib/player/client";

export default function LtiContinuePage() {
  const [error, setError] = useState("");
  useEffect(() => {
    playerFetch<{ homePath: string }>("/api/lti/home").then(({ homePath }) => window.location.replace(homePath)).catch((reason: Error) => setError(reason.message));
  }, []);
  return <main style={{ fontFamily: "Arial, sans-serif", padding: "3rem", textAlign: "center" }}><p>{error || "Opening your course…"}</p>{error && <p><a href="/learn/AIESS/diagnostic" target="_blank">Open AI Essentials in a new window</a></p>}</main>;
}
