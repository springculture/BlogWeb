const JWT_SECRET = 'blog-jwt-secret-key-2024';

function base64UrlEncode(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function createJWT(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = { ...payload, iat: now, exp: now + 86400 * 7 };
  const payloadEncoded = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = await hmacSha256(JWT_SECRET, `${header}.${payloadEncoded}`);
  const sigEncoded = base64UrlEncode(signature);
  return `${header}.${payloadEncoded}.${sigEncoded}`;
}

async function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const signature = base64UrlDecode(parts[2]);
    const expectedSig = await hmacSha256(JWT_SECRET, `${parts[0]}.${parts[1]}`);
    if (base64UrlDecode(parts[2]) !== expectedSig) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
}

function generateSalt() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let salt = '';
  for (let i = 0; i < 16; i++) salt += chars.charAt(Math.floor(Math.random() * chars.length));
  return salt;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

async function getAuthUser(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const payload = await verifyJWT(auth.slice(7));
  if (!payload) return null;
  const { results } = await env.DB.prepare('SELECT id, username, role, approved FROM users WHERE id = ?').bind(payload.userId).all();
  return results.length ? results[0] : null;
}

async function ensureTables(env) {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await env.DB.exec("CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, permission TEXT NOT NULL DEFAULT 'guest', FOREIGN KEY (updated_by) REFERENCES users(id))");
  try { await env.DB.exec("ALTER TABLE content ADD COLUMN permission TEXT NOT NULL DEFAULT 'guest'"); } catch {}
  try { await env.DB.exec("ALTER TABLE content ADD COLUMN format TEXT NOT NULL DEFAULT 'html'"); } catch {}
  await env.DB.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))");
  const sections = ['personal', 'movies', 'books', 'music', 'memos', 'profile', 'guestbook'];
  for (const s of sections) {
    await env.DB.prepare('INSERT OR IGNORE INTO content (section, title, body) VALUES (?, ?, ?)').bind(s, '', '').run();
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join('/');
  const method = request.method;
  await ensureTables(env);

  try {
    const body = method === 'GET' ? null : await request.json().catch(() => ({}));

    // GET /api/check - check if admin exists
    if (path === 'check' && method === 'GET') {
      const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND approved = 1").all();
      return jsonResponse({ adminExists: results[0].count > 0 });
    }

    // POST /api/auth/register
    if (path === 'auth/register' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return errorResponse('用户名和密码不能为空');
      if (username.length < 2) return errorResponse('用户名至少2个字符');


      const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).all();
      if (existing.results.length > 0) return errorResponse('用户名已存在');

      const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND approved = 1").all();
      const isFirstAdmin = results[0].count === 0;

      const salt = generateSalt();
      const passwordHash = await hashPassword(password, salt);
      const role = isFirstAdmin ? 'admin' : 'user';
      const approved = isFirstAdmin ? 1 : 0;

      await env.DB.prepare('INSERT INTO users (username, password_hash, salt, role, approved) VALUES (?, ?, ?, ?, ?)')
        .bind(username, passwordHash, salt, role, approved).run();

      return jsonResponse({
        message: isFirstAdmin ? '管理员账号创建成功' : '注册成功，等待管理员审核',
        isFirstAdmin
      }, 201);
    }

    // POST /api/auth/login
    if (path === 'auth/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return errorResponse('用户名和密码不能为空');

      const { results } = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).all();
      if (results.length === 0) return errorResponse('用户名或密码错误');

      const user = results[0];
      const hash = await hashPassword(password, user.salt);
      if (hash !== user.password_hash) return errorResponse('用户名或密码错误');

      if (!user.approved) return errorResponse('账号尚未通过管理员审核');

      const token = await createJWT({ userId: user.id, username: user.username, role: user.role });
      return jsonResponse({ token, user: { id: user.id, username: user.username, role: user.role, approved: user.approved } });
    }

    // GET /api/auth/me
    if (path === 'auth/me' && method === 'GET') {
      const user = await getAuthUser(request, env);
      if (!user) return errorResponse('未登录', 401);
      return jsonResponse({ user: { id: user.id, username: user.username, role: user.role, approved: user.approved } });
    }

    // GET /api/content
    if (path === 'content' && method === 'GET') {
      const url = new URL(request.url);
      const section = url.searchParams.get('section');
      if (section) {
        const { results } = await env.DB.prepare('SELECT * FROM content WHERE section = ?').bind(section).all();
        if (results.length === 0) return errorResponse('内容不存在', 404);
        return jsonResponse(results[0]);
      }
      const { results } = await env.DB.prepare('SELECT * FROM content ORDER BY id').all();
      return jsonResponse(results);
    }

    // PUT /api/content/:section
    if (path.startsWith('content/') && method === 'PUT') {
      const user = await getAuthUser(request, env);
      if (!user || user.role !== 'admin') return errorResponse('无权限', 403);
      const section = path.slice(8);
      const { title, body: contentBody, permission, format } = body;
      if (!['personal', 'movies', 'books', 'music', 'memos', 'profile', 'guestbook'].includes(section)) return errorResponse('无效的板块');
      if (permission && !['guest', 'user', 'admin'].includes(permission)) return errorResponse('无效的权限');
      if (format && !['html', 'markdown'].includes(format)) return errorResponse('无效的格式');
      const perm = permission || 'guest';
      const fmt = format || 'html';
      await env.DB.prepare('UPDATE content SET title = ?, body = ?, updated_by = ?, updated_at = datetime(\'now\'), permission = ?, format = ? WHERE section = ?')
        .bind(title || '', contentBody || '', user.id, perm, fmt, section).run();
      return jsonResponse({ message: '更新成功' });
    }

    // Admin routes
    if (path.startsWith('admin/')) {
      const user = await getAuthUser(request, env);
      if (!user || user.role !== 'admin') return errorResponse('无权限', 403);

      const adminPath = path.slice(6);

      // GET /api/admin/users
      if (adminPath === 'users' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT id, username, role, approved, created_at FROM users ORDER BY created_at DESC').all();
        return jsonResponse(results);
      }

      // POST /api/admin/users/approve
      if (adminPath === 'users/approve' && method === 'POST') {
        const { userId, approved } = body;
        if (!userId) return errorResponse('缺少用户ID');
        const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).all();
        if (target.results.length === 0) return errorResponse('用户不存在');
        if (target.results[0].role === 'admin' && target.results[0].id !== user.id) return errorResponse('不能修改管理员状态');
        await env.DB.prepare('UPDATE users SET approved = ? WHERE id = ?').bind(approved ? 1 : 0, userId).run();
        return jsonResponse({ message: approved ? '用户已通过审核' : '用户已被拒绝' });
      }

      // POST /api/admin/users/role
      if (adminPath === 'users/role' && method === 'POST') {
        const { userId, role } = body;
        if (!userId || !role) return errorResponse('缺少参数');
        if (!['admin', 'user'].includes(role)) return errorResponse('无效的角色');
        if (parseInt(userId) === user.id) return errorResponse('不能修改自己的角色');
        await env.DB.prepare('UPDATE users SET role = ?, approved = 1 WHERE id = ?').bind(role, userId).run();
        return jsonResponse({ message: '角色已更新' });
      }

      // DELETE /api/admin/users/:id
      if (adminPath.startsWith('users/') && method === 'DELETE') {
        const userId = adminPath.split('/')[1];
        if (!userId) return errorResponse('缺少用户ID');
        if (parseInt(userId) === user.id) return errorResponse('不能删除自己');
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
        return jsonResponse({ message: '用户已删除' });
      }
    }

    // GET /api/guestbook
    if (path === 'guestbook' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, username, content, created_at FROM messages ORDER BY created_at DESC LIMIT 100').all();
      return jsonResponse(results);
    }

    // POST /api/guestbook
    if (path === 'guestbook' && method === 'POST') {
      const user = await getAuthUser(request, env);
      if (!user) return errorResponse('请先登录', 401);
      const { content } = body;
      if (!content || !content.trim()) return errorResponse('内容不能为空');
      if (content.length > 1000) return errorResponse('内容不能超过1000字');
      await env.DB.prepare('INSERT INTO messages (username, content, created_at) VALUES (?, ?, datetime(\'now\',\'localtime\'))').bind(user.username, content.trim()).run();
      return jsonResponse({ message: '留言成功' }, 201);
    }

    // POST /api/search-douban
    if (path === 'search-douban' && method === 'POST') {
      const { q } = body;
      if (!q) return errorResponse('缺少搜索关键词');
      try {
        const results = await searchDouban(q);
        return jsonResponse({ results });
      } catch {
        return jsonResponse({ results: [] });
      }
    }

    // POST /api/fetch-cover
    if (path === 'fetch-cover' && method === 'POST') {
      const { url } = body;
      if (!url) return errorResponse('缺少URL');
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const html = await res.text();
        const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        if (ogMatch) return jsonResponse({ cover: ogMatch[1] });
        const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["'][^>]*>/i);
        if (imgMatch) return jsonResponse({ cover: imgMatch[1] });
        return jsonResponse({ cover: null });
      } catch { return jsonResponse({ cover: null }); }
    }

    return errorResponse('未找到路由', 404);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function searchDouban(query) {
  const searchUrl = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    }
  });
  const html = await res.text();
  const results = [];
  const regex = /<a\s+href="(https:\/\/movie\.douban\.com\/subject\/\d+\/)"[^>]*class="cover-link"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*class="cover"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push({ title: match[3].trim(), url: match[1], cover: match[2] });
    if (results.length >= 5) break;
  }
  return results;
}
