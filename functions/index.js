async function ensureTables(env) {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, permission TEXT NOT NULL DEFAULT 'guest', FOREIGN KEY (updated_by) REFERENCES users(id))");
  try { await env.DB.exec("ALTER TABLE content ADD COLUMN permission TEXT NOT NULL DEFAULT 'guest'"); } catch {}
  try { await env.DB.exec("ALTER TABLE content ADD COLUMN format TEXT NOT NULL DEFAULT 'html'"); } catch {}
  const sections = ['personal', 'movies', 'books', 'music', 'memos', 'profile', 'guestbook'];
  for (const s of sections) {
    await env.DB.prepare('INSERT OR IGNORE INTO content (section, title, body) VALUES (?, ?, ?)').bind(s, '', '').run();
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.ok) return assetResponse;

  let html = await assetResponse.text();

  try {
    await ensureTables(env);
    const { results } = await env.DB.prepare('SELECT * FROM content').all();
    const safe = JSON.stringify(results).replace(/<\/script>/gi, '<\\/script>');
    html = html.replace('</head>', `<script>window.__INITIAL_CONTENT__=${safe};<\/script></head>`);
  } catch {}

  return new Response(html, {
    headers: { 'content-type': 'text/html;charset=UTF-8' }
  });
}
