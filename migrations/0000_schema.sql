CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT OR IGNORE INTO content (section, title, body) VALUES ('personal', '个人信息', '');
INSERT OR IGNORE INTO content (section, title, body) VALUES ('movies', '观影指南', '');
INSERT OR IGNORE INTO content (section, title, body) VALUES ('books', '读书笔记', '');
INSERT OR IGNORE INTO content (section, title, body) VALUES ('music', '音乐收藏', '');
INSERT OR IGNORE INTO content (section, title, body) VALUES ('memos', '备忘录', '');
