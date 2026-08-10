"use client";

import { useEffect, useState } from "react";
import { playerFetch } from "@/lib/player/client";

type Overview = {
  course: string;
  context: string | null;
  lessonCount: number;
  learners: Array<{ id: string; name: string; completedLessons: number; completedMilestones: number }>;
};

export default function LtiInstructorPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    playerFetch<Overview>("/api/lti/instructor/overview").then(setData).catch((reason: Error) => setError(reason.message));
  }, []);
  return <main style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem", fontFamily: "Arial, sans-serif" }}>
    <h1>{data?.course ?? "AI Essentials instructor view"}</h1>
    {data?.context && <p>{data.context}</p>}
    {error && <p style={{ color: "#b42318" }}>{error}</p>}
    {!data && !error && <p>Loading course progress…</p>}
    {data && <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={{ textAlign: "left", padding: ".7rem", borderBottom: "1px solid #ddd" }}>Learner</th><th>Lessons</th><th>Capstone milestones</th></tr></thead><tbody>{data.learners.map((learner) => <tr key={learner.id}><td style={{ padding: ".7rem", borderBottom: "1px solid #eee" }}>{learner.name}</td><td style={{ textAlign: "center" }}>{learner.completedLessons}/{data.lessonCount}</td><td style={{ textAlign: "center" }}>{learner.completedMilestones}/5</td></tr>)}</tbody></table>}
  </main>;
}
