-- One-time acceptance: drop the version concept from terms_acceptance.
-- A headteacher accepts once, ever; doc revisions are tracked by the
-- TERMS.version label in code, which no longer gates anything.
-- Applied live 2026-09-06 via backup → DROP TABLE → CREATE → restore
-- (TiDB clustered PKs reject DROP PRIMARY KEY, and the table held 1 row).
-- Safe re-run only on the old shape; the app's inline DDL now creates the
-- versionless table directly.
DELETE t1 FROM terms_acceptance t1
  JOIN terms_acceptance t2
    ON t1.teacher_id = t2.teacher_id AND t1.accepted_at > t2.accepted_at;
ALTER TABLE terms_acceptance DROP PRIMARY KEY;
ALTER TABLE terms_acceptance DROP COLUMN version;
ALTER TABLE terms_acceptance ADD PRIMARY KEY (teacher_id);
