-- SKILLS focus group: what participants actually typed.
--
-- Reads the learner side of the lesson thread. Player turns carry the course
-- and block in Message.metadata, so this needs no mentor assignment and no
-- dashboard -- which matters, because a SKILLS learner has neither.
--
-- Excludes 'lesson_entry' and 'expand': those are canned strings the client
-- sends on the learner's behalf, not words anyone typed.
SELECT
  s.name                              AS learner,
  m.metadata->>'blockId'              AS block,
  to_char(m.created_at, 'HH24:MI')    AS at,
  m.content                           AS said
FROM messages m
JOIN socios s ON s.id = m.socio_id
WHERE m.role = 'user'
  AND m.assessment_session_id IS NULL
  AND m.metadata->>'collectionKey' = 'skills-tool-calls'
  AND COALESCE(m.metadata->>'intent', '') NOT IN ('lesson_entry', 'expand')
ORDER BY s.name, m.created_at;
