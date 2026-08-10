import { DiagnosticPlayer } from "@/components/player/DiagnosticPlayer";

export default async function DiagnosticPage({ params }: { params: Promise<{ course: string }> }) {
  return <DiagnosticPlayer course={(await params).course} />;
}
