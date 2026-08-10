import { LessonPlayer } from "@/components/player/LessonPlayer";

export default async function LessonPage({ params }: { params: Promise<{ course: string; lessonKey: string }> }) {
  const { course, lessonKey } = await params;
  return <LessonPlayer course={course} lessonKey={lessonKey} />;
}
