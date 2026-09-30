-- The per-vault notes index. Everything here is a cache derived from the
-- markdown files, so the whole database can be dropped and rebuilt.
-- Paths are vault-relative and '/'-separated; times are ms since the epoch.

CREATE TABLE notes (
    id          INTEGER PRIMARY KEY,
    path        TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    hash        TEXT    NOT NULL, -- blake3 hex of the file contents
    mtime       REAL    NOT NULL,
    size        INTEGER,
    frontmatter TEXT,             -- JSON
    indexed_at  REAL
);
CREATE INDEX notes_mtime ON notes (mtime);

CREATE TABLE links (
    source_id   INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    target_raw  TEXT    NOT NULL, -- target as written, without #heading and |alias
    target_path TEXT,             -- resolved vault path, NULL while unresolved
    heading     TEXT,
    alias       TEXT,
    is_embed    INTEGER NOT NULL DEFAULT 0,
    line        INTEGER NOT NULL, -- 0-based
    context     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX links_target_path ON links (target_path);
CREATE INDEX links_source_id ON links (source_id);
CREATE INDEX links_target_raw ON links (target_raw COLLATE NOCASE);

CREATE TABLE tags (
    note_id INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag     TEXT    NOT NULL,
    PRIMARY KEY (note_id, tag)
) WITHOUT ROWID;
CREATE INDEX tags_tag ON tags (tag);

CREATE TABLE headings (
    note_id INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    level   INTEGER NOT NULL,
    text    TEXT    NOT NULL,
    slug    TEXT    NOT NULL,
    line    INTEGER NOT NULL
);
CREATE INDEX headings_note_id ON headings (note_id);

CREATE TABLE tasks (
    note_id INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    line    INTEGER NOT NULL,
    text    TEXT    NOT NULL,
    done    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tasks_note_id ON tasks (note_id);

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT
) WITHOUT ROWID;
