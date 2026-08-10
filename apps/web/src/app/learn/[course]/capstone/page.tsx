import { CapstonePlayer } from "@/components/player/CapstonePlayer";

export default async function CapstonePage({ params }: { params: Promise<{ course: string }> }) {
  return <CapstonePlayer course={(await params).course} />;
}
