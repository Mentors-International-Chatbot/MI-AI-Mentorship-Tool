"use client";

import { useEffect, useState } from "react";
import { playerFetch } from "@/lib/player/client";

type Item = { id: string; type: string; title: string };

export default function DeepLinkPage() {
  const [items, setItems] = useState<Item[]>([]); const [selected, setSelected] = useState<string[]>([]); const [error, setError] = useState("");
  useEffect(() => { playerFetch<{ items: Item[] }>("/api/lti/deep-link/catalog").then((data) => setItems(data.items)).catch((reason: Error) => setError(reason.message)); }, []);
  async function submit() {
    try {
      const result = await playerFetch<{ returnUrl: string; jwt: string }>("/api/lti/deep-link/response", { method: "POST", body: JSON.stringify({ itemIds: selected }) });
      const form = document.createElement("form"); form.method = "POST"; form.action = result.returnUrl;
      const input = document.createElement("input"); input.type = "hidden"; input.name = "JWT"; input.value = result.jwt;
      form.appendChild(input); document.body.appendChild(form); form.submit();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add content"); }
  }
  return <main style={{ maxWidth: 760, margin: "3rem auto", padding: "1rem", fontFamily: "Arial, sans-serif" }}><h1>Add AI Essentials content</h1><p>Select course links, individual lessons, or the graded capstone.</p>{items.map((item) => <label key={item.id} style={{ display: "flex", gap: ".7rem", padding: ".8rem", borderBottom: "1px solid #ddd" }}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, item.id] : value.filter((id) => id !== item.id))} /><span><strong>{item.title}</strong><br /><small>{item.type}</small></span></label>)}<button onClick={submit} disabled={selected.length === 0} style={{ marginTop: "1rem", padding: ".8rem 1.2rem" }}>Add selected content</button>{error && <p style={{ color: "#b42318" }}>{error}</p>}</main>;
}
