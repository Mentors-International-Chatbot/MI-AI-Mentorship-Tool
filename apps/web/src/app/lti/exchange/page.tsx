"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LtiExchangePage() {
  const search = useSearchParams();
  const code = search.get("code");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!code) return;
    fetch("/api/lti/session-exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to open this launch");
        window.sessionStorage.setItem("oci_lti_token", body.token);
        window.location.replace(body.destination);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [code]);
  return <main style={{ padding: "3rem", textAlign: "center", fontFamily: "Arial, sans-serif" }}><p>{error || (!code ? "This launch link is incomplete." : "Opening AI Essentials in this tab…")}</p></main>;
}
