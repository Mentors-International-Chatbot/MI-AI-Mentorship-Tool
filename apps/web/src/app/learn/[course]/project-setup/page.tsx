import { ProjectSetupPlayer } from "@/components/player/ProjectSetupPlayer";

export default async function ProjectSetupPage({ params }: { params: Promise<{ course: string }> }) {
  return <ProjectSetupPlayer course={(await params).course} />;
}
