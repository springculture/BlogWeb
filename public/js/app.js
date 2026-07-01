const API_BASE = '/api';
const SECTIONS = ['personal', 'movies', 'books', 'music', 'memos', 'guestbook'];
const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><rect fill="#E1F5FE" width="90" height="90"/><text x="45" y="55" text-anchor="middle" fill="#4FC3F7" font-size="36" font-family="Arial">&#x1F464;</text></svg>');

let state = {
  user: null,
  token: localStorage.getItem('token') || null,
  currentSection: 'personal',
  contentCache: {},
  profileCache: {},
  doubanItems: {},
  doubanCurrentRating: {},
  doubanEditIndex: {}
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}/${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ===== Auth =====
async function checkAuth() {
  if (!state.token) return;
  try {
    const data = await api('auth/me');
    state.user = data.user;
    updateUI();
  } catch {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
    updateUI();
  }
}

async function checkAdminExists() {
  try {
    const data = await api('check');
    return data.adminExists;
  } catch {
    return true;
  }
}

async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) { errorEl.textContent = '请填写用户名和密码'; return; }

  try {
    const data = await api('auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    closeModal();
    updateUI();
    loadCurrentContent();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function register() {
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  if (!username || !password) { errorEl.textContent = '请填写用户名和密码'; return; }
  if (username.length < 2) { errorEl.textContent = '用户名至少2个字符'; return; }

  if (password !== confirm) { errorEl.textContent = '两次密码输入不一致'; return; }

  try {
    const data = await api('auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    document.getElementById('register-form').style.display = 'none';
    const successEl = document.getElementById('register-success');
    successEl.style.display = 'block';
    if (data.isFirstAdmin) {
      document.getElementById('register-success-msg').textContent = '管理员账号创建成功！请使用该账号登录。';
    } else {
      document.getElementById('register-success-msg').textContent = '注册成功！请等待管理员审核通过后即可登录。';
    }
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  updateUI();
  loadCurrentContent();
}

// ===== Modal =====
function showModal(type) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('login-form').style.display = type === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = type === 'register' ? 'block' : 'none';
  document.getElementById('register-success').style.display = 'none';
  document.getElementById('modal-title').textContent = type === 'login' ? '登录' : '注册';
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('register-username').value = '';
  document.getElementById('register-password').value = '';
  document.getElementById('register-confirm').value = '';

  checkAdminExists().then(exists => {
    if (!exists) {
      document.getElementById('register-form').style.display = 'block';
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('modal-title').textContent = '创建管理员账号';
      document.getElementById('register-success-msg').textContent = '';
    }
  });
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').style.display = 'none';
}

function switchAuthForm(type) {
  showModal(type);
}

// ===== Tab Switching =====
function switchTab(section) {
  state.currentSection = section;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
  document.querySelectorAll('.content-card').forEach(card => {
    card.classList.toggle('active', card.id === `section-${section}`);
  });
  if (section === 'admin') {
    loadAdminPanel();
  } else if (section === 'guestbook') {
    loadSectionContent(section, false);
    loadGuestbook();
  } else {
    loadSectionContent(section, false);
  }
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.section));
  });
}

// ===== Content =====
async function loadCurrentContent() {
  if (state.currentSection && state.currentSection !== 'admin') {
    loadSectionContent(state.currentSection, false);
  }
}

async function loadSectionContent(section, forceEdit = false) {
  const bodyEl = document.getElementById(`body-${section}`);
  const editorEl = document.getElementById(`editor-${section}`);
  const editBtn = document.querySelector(`.edit-btn[data-section="${section}"]`);

  if (state.user && state.user.role === 'admin') {
    editBtn.style.display = 'inline-flex';
  } else {
    editBtn.style.display = 'none';
  }

  if (forceEdit) {
    bodyEl.style.display = 'none';
    editorEl.style.display = 'block';
    return;
  }

  // Show cached content immediately
  if (state.contentCache[section]) {
    displayContent(section, state.contentCache[section]);
    return;
  }

  // Fetch if not cached
  try {
    const data = await api(`content?section=${section}`);
    state.contentCache[section] = data;
    displayContent(section, data);
  } catch {
    bodyEl.innerHTML = '<div class="empty-state"><p>暂无内容</p></div>';
  }
}

function displayContent(section, data) {
  const bodyEl = document.getElementById(`body-${section}`);
  const editorEl = document.getElementById(`editor-${section}`);
  const permBadge = document.getElementById(`perm-${section}`);

  // Douban-style display for movies/books
  if ((section === 'movies' || section === 'books') && data.body) {
    try {
      const items = JSON.parse(data.body);
      if (Array.isArray(items)) {
        renderDoubanDisplay(bodyEl, section, items, data.title);
        bodyEl.style.display = 'block';
        if (editorEl) editorEl.style.display = 'none';
        if (permBadge) { permBadge.className = 'perm-badge ' + (data.permission || 'guest'); }
        updateTabVisibility(section, data.permission || 'guest');
        return;
      }
    } catch {}
  }

  const body = data.body || '';
  const format = data.format || 'html';
  let contentHTML = body;
  if (format === 'markdown' && typeof marked !== 'undefined') {
    try { contentHTML = marked.parse(body); } catch { contentHTML = body; }
  }

  if (data.title) {
    bodyEl.innerHTML = `<h1>${escapeHtml(data.title)}</h1><hr>${contentHTML || '<div class="empty-state"><p>暂无内容</p></div>'}`;
  } else {
    bodyEl.innerHTML = contentHTML || '<div class="empty-state"><p>暂无内容</p></div>';
  }

  const permMap = { guest: '游客可见', user: '登录用户可见', admin: '管理员可见' };
  const perm = data.permission || 'guest';
  if (permBadge) {
    permBadge.textContent = permMap[perm] || '';
    permBadge.className = 'perm-badge ' + perm;
  }

  bodyEl.style.display = 'block';
  if (editorEl) editorEl.style.display = 'none';
  updateTabVisibility(section, perm);
}

function updateTabVisibility(section, permission) {
  const tabBtn = document.querySelector(`.tab-btn[data-section="${section}"]`);
  if (!tabBtn) return;
  const role = state.user ? state.user.role : 'guest';
  if (permission === 'guest') tabBtn.style.display = '';
  else if (permission === 'user') tabBtn.style.display = (role === 'guest') ? 'none' : '';
  else if (permission === 'admin') tabBtn.style.display = (role === 'admin') ? '' : 'none';
}

function startEdit(section) {
  if (section === 'movies' || section === 'books') {
    startDoubanEdit(section);
    return;
  }
  const data = state.contentCache[section] || {};
  document.getElementById(`title-${section}`).value = data.title || '';
  document.getElementById(`body-editor-${section}`).value = data.body || '';
  document.getElementById(`perm-select-${section}`).value = data.permission || 'guest';
  const fmtToggle = document.getElementById(`format-toggle-${section}`);
  if (fmtToggle) fmtToggle.checked = (data.format === 'markdown');
  const preview = document.getElementById(`preview-${section}`);
  if (preview) preview.classList.remove('show');
  document.getElementById(`body-${section}`).style.display = 'none';
  document.getElementById(`editor-${section}`).style.display = 'block';
}

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('edit-btn')) {
    startEdit(e.target.dataset.section);
  }
});

async function saveContent(section) {
  let title, body, permission, format;

  if (section === 'movies' || section === 'books') {
    title = document.getElementById(`title-${section}`).value.trim();
    body = JSON.stringify(state.doubanItems[section] || []);
    permission = document.getElementById(`perm-select-${section}`).value;
    format = 'html';
  } else {
    title = document.getElementById(`title-${section}`).value.trim();
    body = document.getElementById(`body-editor-${section}`).value;
    permission = document.getElementById(`perm-select-${section}`).value;
    const fmtToggle = document.getElementById(`format-toggle-${section}`);
    format = (fmtToggle && fmtToggle.checked) ? 'markdown' : 'html';
  }

  try {
    await api(`content/${section}`, {
      method: 'PUT',
      body: JSON.stringify({ title, body, permission, format })
    });
    state.contentCache[section] = { title, body, permission, format };
    displayContent(section, { title, body, permission, format });
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

function cancelEdit(section) {
  const data = state.contentCache[section];
  if (data) {
    displayContent(section, data);
  } else {
    document.getElementById(`body-${section}`).style.display = 'block';
    document.getElementById(`editor-${section}`).style.display = 'none';
  }
}

// ===== Admin Panel =====
async function loadAdminPanel() {
  try {
    const users = await api('admin/users');
    renderUsers(users);
  } catch (err) {
    document.getElementById('users-tbody').innerHTML = `<tr><td colspan="6">加载失败: ${err.message}</td></tr>`;
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6">暂无用户</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const isSelf = state.user && state.user.id === u.id;
    const roleBadge = u.role === 'admin' ? '<span class="role-badge admin">管理员</span>' : '<span class="role-badge user">用户</span>';
    const statusBadge = u.approved ? '<span class="role-badge approved">已通过</span>' : '<span class="role-badge pending">待审核</span>';

    let actions = '';
    if (!isSelf) {
      if (!u.approved) {
        actions += `<button class="btn btn-success btn-sm" onclick="approveUser(${u.id}, true)">通过</button>`;
      }
      if (u.approved && u.role === 'user') {
        actions += `<button class="btn btn-primary btn-sm" onclick="setRole(${u.id}, 'admin')">设为管理员</button>`;
      }
      if (u.role === 'admin' && u.approved) {
        actions += `<button class="btn btn-outline btn-sm" onclick="setRole(${u.id}, 'user')">取消管理员</button>`;
      }
      actions += `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">删除</button>`;
    } else {
      actions = '<span style="color:var(--text-light);font-size:12px">当前账号</span>';
    }

    return `<tr>
      <td>${u.id}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td>${u.created_at}</td>
      <td class="action-btns">${actions}</td>
    </tr>`;
  }).join('');
}

async function approveUser(userId, approved) {
  try {
    await api('admin/users/approve', {
      method: 'POST',
      body: JSON.stringify({ userId, approved })
    });
    loadAdminPanel();
  } catch (err) {
    alert(err.message);
  }
}

async function setRole(userId, role) {
  try {
    await api('admin/users/role', {
      method: 'POST',
      body: JSON.stringify({ userId, role })
    });
    loadAdminPanel();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteUser(userId) {
  if (!confirm('确定要删除该用户吗？')) return;
  try {
    await api(`admin/users/${userId}`, { method: 'DELETE' });
    loadAdminPanel();
  } catch (err) {
    alert(err.message);
  }
}

// ===== Lunar Calendar =====
const lunarData = [
  0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
  0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
  0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
  0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
  0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
  0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
  0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
  0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,
  0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
  0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,
  0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
  0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
  0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
  0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
  0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
  0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06aa0,0x1a6c4,0x0aae0,
  0x092e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,
  0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,
  0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,
  0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a4d0,0x0d150,0x0f252,
  0x0d520
];

const lunarMonthNames = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const lunarDayNames = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
const heavenlyStems = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const earthlyBranches = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const zodiacAnimals = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];

function daysInLunarYear(year) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (lunarData[year - 1900] & i) ? 1 : 0;
  return sum + leapDaysInLunarYear(year);
}

function leapDaysInLunarYear(year) {
  return lunarData[year - 1900] & 0x10000 ? 30 : 29;
}

function leapMonthInLunarYear(year) {
  return lunarData[year - 1900] & 0xf;
}

function daysInLunarMonth(year, month) {
  return lunarData[year - 1900] & (0x10000 >> month) ? 30 : 29;
}

function solarToLunar(year, month, day) {
  const baseDate = new Date(1900, 0, 31);
  const targetDate = new Date(year, month - 1, day);
  let offset = Math.floor((targetDate - baseDate) / 86400000);
  if (offset < 0) return null;

  let lunarYear;
  let days = 0;
  for (lunarYear = 1900; lunarYear < 2101 && days + daysInLunarYear(lunarYear) <= offset; lunarYear++) {
    days += daysInLunarYear(lunarYear);
  }
  if (lunarYear > 2100) return null;

  let leapMonth = leapMonthInLunarYear(lunarYear);
  let isLeap = false;
  let lunarMonth;

  for (lunarMonth = 1; lunarMonth <= 12 && days + daysInLunarMonth(lunarYear, lunarMonth) <= offset; lunarMonth++) {
    days += daysInLunarMonth(lunarYear, lunarMonth);
    if (lunarMonth === leapMonth && !isLeap) {
      if (days + leapDaysInLunarYear(lunarYear) <= offset) {
        days += leapDaysInLunarYear(lunarYear);
      } else {
        isLeap = true;
        break;
      }
    }
  }

  if (lunarMonth > 12) {
    if (leapMonth > 0 && !isLeap) {
      isLeap = true;
      if (days + leapDaysInLunarYear(lunarYear) <= offset) {
        days += leapDaysInLunarYear(lunarYear);
        lunarMonth = 1;
      }
    } else {
      lunarMonth = 1;
    }
  }

  const lunarDay = offset - days + 1;
  const stemIndex = (lunarYear - 4) % 10;
  const branchIndex = (lunarYear - 4) % 12;
  const ganZhi = heavenlyStems[stemIndex] + earthlyBranches[branchIndex];
  const zodiac = zodiacAnimals[branchIndex];

  return {
    year: lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeap,
    monthName: (isLeap ? '闰' : '') + lunarMonthNames[lunarMonth - 1] + '月',
    dayName: lunarDayNames[lunarDay - 1],
    ganZhi,
    zodiac
  };
}

const solarFestivals = {
  '01-01': '元旦',
  '02-14': '情人节',
  '03-08': '妇女节',
  '03-12': '植树节',
  '04-01': '愚人节',
  '04-05': '清明节',
  '04-22': '世界地球日',
  '05-01': '劳动节',
  '05-04': '青年节',
  '05-12': '护士节',
  '06-01': '儿童节',
  '06-05': '世界环境日',
  '07-01': '建党节',
  '08-01': '建军节',
  '09-10': '教师节',
  '10-01': '国庆节',
  '10-16': '世界粮食日',
  '12-25': '圣诞节'
};

const lunarFestivals = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕节',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-30': '除夕'
};

function getFestivals(solarDate, lunarDate) {
  const festivals = [];
  const key = String(solarDate.month).padStart(2, '0') + '-' + String(solarDate.day).padStart(2, '0');
  if (solarFestivals[key]) festivals.push(solarFestivals[key]);
  const lKey = lunarDate.month + '-' + lunarDate.day;
  if (lunarFestivals[lKey]) festivals.push(lunarFestivals[lKey]);
  const lKey30 = lunarDate.month + '-30';
  if (lunarFestivals[lKey30] && lunarDate.day === daysInLunarMonth(lunarDate.year, lunarDate.month)) {
    festivals.push(lunarFestivals[lKey30]);
  }
  return festivals;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = weekDayNames[now.getDay()];
  const weekNum = getWeekNumber(now);

  document.getElementById('cal-day').textContent = String(day).padStart(2, '0');
  document.getElementById('cal-month-year').textContent = `${year}年${month}月`;
  document.getElementById('cal-weekday').textContent = `星期${weekday}`;
  document.getElementById('cal-week').textContent = `第 ${weekNum} 周`;

  const lunar = solarToLunar(year, month, day);
  if (lunar) {
    document.getElementById('cal-lunar').textContent = `农历${lunar.ganZhi}年 ${lunar.monthName}${lunar.dayName}`;

    const festivals = getFestivals({ month, day }, lunar);
    const container = document.getElementById('cal-festivals');
    if (festivals.length > 0) {
      container.innerHTML = festivals.map(f => `<span class="festival-badge">${f}</span>`).join('');
    } else {
      container.innerHTML = '';
    }
  }
}

// ===== Profile =====
async function loadProfile() {
  // Use cached/SSR data if available
  const cached = state.contentCache['profile'];
  if (cached) {
    try {
      const body = cached.body || '{}';
      const parsed = JSON.parse(body);
      const avatar = parsed.avatar || '';
      let nickname = parsed.nickname || '';
      const signature = parsed.signature || '';
      if (cached.title) nickname = nickname || cached.title;
      document.getElementById('avatar-img').src = avatar || DEFAULT_AVATAR;
      document.getElementById('nickname-display').textContent = nickname || '我的博客';
      document.getElementById('signature-display').textContent = signature || '欢迎来到我的个人博客';
      state.profileCache = { avatar, nickname, signature };
      saveProfileToCache();
      return;
    } catch {}
  }

  try {
    const data = await api('content?section=profile');
    let avatar = '', nickname = '', signature = '';
    if (data.body) {
      try {
        const parsed = JSON.parse(data.body);
        avatar = parsed.avatar || '';
        nickname = parsed.nickname || '';
        signature = parsed.signature || '';
      } catch {}
    }
    if (data.title) nickname = nickname || data.title;
    document.getElementById('avatar-img').src = avatar || DEFAULT_AVATAR;
    document.getElementById('nickname-display').textContent = nickname || '我的博客';
    document.getElementById('signature-display').textContent = signature || '欢迎来到我的个人博客';
    state.profileCache = { avatar, nickname, signature };
    saveProfileToCache();
  } catch {
    document.getElementById('avatar-img').src = DEFAULT_AVATAR;
    document.getElementById('nickname-display').textContent = '我的博客';
    document.getElementById('signature-display').textContent = '欢迎来到我的个人博客';
  }
}

function startProfileEdit() {
  const p = state.profileCache || {};
  document.getElementById('edit-avatar').value = p.avatar || '';
  document.getElementById('edit-nickname').value = p.nickname || '';
  document.getElementById('edit-signature').value = p.signature || '';
  document.getElementById('profile-display').style.display = 'none';
  document.getElementById('profile-editor').style.display = 'block';
}

function cancelProfileEdit() {
  document.getElementById('profile-display').style.display = 'block';
  document.getElementById('profile-editor').style.display = 'none';
}

async function saveProfile() {
  const avatar = document.getElementById('edit-avatar').value.trim();
  const nickname = document.getElementById('edit-nickname').value.trim();
  const signature = document.getElementById('edit-signature').value.trim();
  const body = JSON.stringify({ avatar, nickname, signature });
  try {
    await api('content/profile', {
      method: 'PUT',
      body: JSON.stringify({ title: nickname, body })
    });
    state.profileCache = { avatar, nickname, signature };
    saveProfileToCache();
    document.getElementById('avatar-img').src = avatar || DEFAULT_AVATAR;
    document.getElementById('nickname-display').textContent = nickname || '我的博客';
    document.getElementById('signature-display').textContent = signature || '欢迎来到我的个人博客';
    cancelProfileEdit();
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

// ===== Guestbook =====
async function loadGuestbook() {
  const listEl = document.getElementById('guestbook-list');
  try {
    const messages = await api('guestbook');
    if (!messages.length) {
      listEl.innerHTML = '<div class="empty-state"><p>还没有留言，来写第一条吧 ✨</p></div>';
    } else {
      listEl.innerHTML = messages.map(msg => `
        <div class="guestbook-item">
          <div class="guestbook-item-header">
            <span class="guestbook-item-user">${escapeHtml(msg.username)}</span>
            <span class="guestbook-item-time">${msg.created_at}</span>
          </div>
          <div class="guestbook-item-content">${escapeHtml(msg.content)}</div>
        </div>
      `).join('');
    }
  } catch {
    listEl.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
  }
  updateGuestbookUI();
}

function updateGuestbookUI() {
  const input = document.getElementById('guestbook-input');
  const submitBtn = document.getElementById('guestbook-submit');
  const hint = document.getElementById('guestbook-hint');
  if (state.user) {
    input.disabled = false;
    submitBtn.disabled = false;
    hint.textContent = `留言作为 ${state.user.username}`;
  } else {
    input.disabled = true;
    submitBtn.disabled = true;
    hint.textContent = '登录后可留言';
  }
}

async function postGuestbook() {
  const input = document.getElementById('guestbook-input');
  const content = input.value.trim();
  if (!content) return;
  try {
    await api('guestbook', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    input.value = '';
    loadGuestbook();
  } catch (err) {
    alert('发布失败: ' + err.message);
  }
}

// ===== UI Updates =====
function updateUI() {
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-name');
  const adminTab = document.querySelector('.tab-btn[data-section="admin"]');

  const editProfileBtn = document.getElementById('edit-profile-btn');

  if (state.user) {
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
    userMenu.style.display = 'flex';
    userName.textContent = state.user.username;

    if (state.user.role === 'admin') {
      adminTab.style.display = 'inline-flex';
      editProfileBtn.style.display = 'inline-flex';
    } else {
      adminTab.style.display = 'none';
      editProfileBtn.style.display = 'none';
      if (state.currentSection === 'admin') switchTab('personal');
    }

    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.style.display = 'inline-flex';
    });
  } else {
    loginBtn.style.display = 'inline-flex';
    registerBtn.style.display = 'inline-flex';
    userMenu.style.display = 'none';

    adminTab.style.display = 'none';
    editProfileBtn.style.display = 'none';
    if (state.currentSection === 'admin') switchTab('personal');

    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.style.display = 'none';
    });
  }
  // Refresh tab visibility based on permissions
  Object.keys(state.contentCache).forEach(s => {
    const perm = (state.contentCache[s].permission || 'guest');
    updateTabVisibility(s, perm);
  });
  updateGuestbookUI();
}

// ===== Utils =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Preload =====
let preloadDone = false;
let scrollTopTimer = null;

function updateScrollTop() {
  const btn = document.getElementById('scroll-top');
  if (!btn) return;
  if (window.scrollY > 200) {
    btn.classList.add('visible');
    clearTimeout(scrollTopTimer);
    scrollTopTimer = setTimeout(() => btn.classList.remove('visible'), 2000);
  } else {
    btn.classList.remove('visible');
    clearTimeout(scrollTopTimer);
  }
}

window.addEventListener('scroll', updateScrollTop);

function restoreContentFromCache() {
  try {
    // 1. SSR-injected data (highest priority, always fresh)
    if (window.__INITIAL_CONTENT__) {
      const list = window.__INITIAL_CONTENT__;
      window.__INITIAL_CONTENT__ = null;
      for (const item of list) {
        state.contentCache[item.section] = item;
      }
      preloadDone = true;
      return 'ssr';
    }
    // 2. localStorage (for subsequent visits)
    const cached = localStorage.getItem('content_cache_v1');
    if (cached) {
      const list = JSON.parse(cached);
      for (const item of list) {
        state.contentCache[item.section] = item;
      }
      return 'cache';
    }
    return false;
  } catch { return false; }
}

function saveContentToCache() {
  try {
    localStorage.setItem('content_cache_v1', JSON.stringify(Object.values(state.contentCache)));
  } catch {}
}

function restoreProfileFromCache() {
  const profileData = state.contentCache['profile'];
  if (profileData) {
    try {
      const body = profileData.body || '{}';
      const parsed = JSON.parse(body);
      const avatar = parsed.avatar || '';
      let nickname = parsed.nickname || '';
      const signature = parsed.signature || '';
      if (profileData.title) nickname = nickname || profileData.title;
      state.profileCache = { avatar, nickname, signature };
      document.getElementById('avatar-img').src = avatar || DEFAULT_AVATAR;
      document.getElementById('nickname-display').textContent = nickname || '我的博客';
      document.getElementById('signature-display').textContent = signature || '欢迎来到我的个人博客';
      return true;
    } catch {}
  }

  try {
    const cached = localStorage.getItem('profile_cache_v1');
    if (!cached) return false;
    const p = JSON.parse(cached);
    state.profileCache = p;
    document.getElementById('avatar-img').src = p.avatar || DEFAULT_AVATAR;
    document.getElementById('nickname-display').textContent = p.nickname || '我的博客';
    document.getElementById('signature-display').textContent = p.signature || '欢迎来到我的个人博客';
    return true;
  } catch { return false; }
}

function saveProfileToCache() {
  try {
    localStorage.setItem('profile_cache_v1', JSON.stringify(state.profileCache));
  } catch {}
}

async function preloadAllContent() {
  if (preloadDone) return;
  try {
    const all = await api('content');
    for (const item of all) {
      state.contentCache[item.section] = item;
    }
    preloadDone = true;
    saveContentToCache();
  } catch {}
}

// ===== Init =====
async function init() {
  initTabs();
  initEditorExtras();

  document.getElementById('login-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); login(); }
  });
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); login(); }
  });
  document.getElementById('register-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); register(); }
  });
  document.getElementById('register-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); register(); }
  });
  document.getElementById('register-confirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); register(); }
  });

  document.getElementById('edit-profile-btn').addEventListener('click', startProfileEdit);

  const avatarImg = document.getElementById('avatar-img');
  avatarImg.addEventListener('error', () => {
    avatarImg.src = DEFAULT_AVATAR;
  });

  renderCalendar();

  // 1. Restore: SSR > localStorage — instant, no network
  const source = restoreContentFromCache();
  restoreProfileFromCache();
  switchTab('personal');

  // 2. Auth check
  await checkAuth();

  // 3. SSR data is per-request fresh from D1 → just persist locally
  if (source === 'ssr') {
    saveContentToCache();
  } else {
    // Cache or first visit → fetch fresh data in background
    await preloadAllContent();
    const s = state.currentSection;
    if (s && s !== 'admin' && s !== 'guestbook' && state.contentCache[s]) {
      displayContent(s, state.contentCache[s]);
    }
  }

  // 4. Profile (skips API if already in contentCache from SSR)
  await loadProfile();
  saveProfileToCache();
}

// ===== Markdown helpers =====
function initEditorExtras() {
  for (const section of SECTIONS) {
    const actions = document.querySelector(`#editor-${section} .editor-actions`);
    if (!actions) continue;

    // Preview button (for non-movies/books)
    if (section !== 'movies' && section !== 'books') {
      const previewBtn = document.createElement('button');
      previewBtn.className = 'btn btn-sm btn-outline';
      previewBtn.textContent = '预览';
      previewBtn.onclick = () => previewMarkdown(section);
      previewBtn.style.marginLeft = 'auto';
      actions.insertBefore(previewBtn, actions.firstChild);

      // Image upload button
      const imgBtn = document.createElement('button');
      imgBtn.className = 'btn btn-sm btn-outline';
      imgBtn.textContent = '🖼️';
      imgBtn.title = '上传图片（转Base64嵌入）';
      imgBtn.onclick = () => uploadImage(section);
      actions.insertBefore(imgBtn, previewBtn);

      const textarea = document.getElementById(`body-editor-${section}`);
      const preview = document.createElement('div');
      preview.className = 'markdown-preview';
      preview.id = `preview-${section}`;
      textarea.parentNode.insertBefore(preview, textarea.nextSibling);
    }

    // Douban editor form for movies/books
    if (section === 'movies' || section === 'books') {
      const textarea = document.getElementById(`body-editor-${section}`);
      const doubanHTML = `
        <div class="douban-editor" id="douban-editor-${section}" style="display:none">
          <div class="douban-editor-list" id="douban-list-${section}"><p class="empty-state" style="padding:12px">暂无项目</p></div>
          <div class="douban-form">
            <div class="douban-form-row">
              <input type="text" class="douban-input" id="douban-title-${section}" placeholder="标题（输入后点🔍去豆瓣搜索）">
              <button class="btn btn-sm btn-primary" onclick="searchDoubanItem('${section}')" title="在豆瓣中搜索">🔍</button>
              <input type="url" class="douban-input" id="douban-url-${section}" placeholder="豆瓣链接">
              <button class="btn btn-sm btn-outline" onclick="fetchCover('${section}')" title="从豆瓣页面提取封面">🖼️</button>
            </div>
            <div class="douban-form-row">
              <input type="url" class="douban-input" id="douban-cover-input-${section}" placeholder="封面图片URL（手动输入）">
            </div>
            <div class="douban-cover-preview" id="douban-cover-${section}" style="display:none">
              <img src="" alt="封面预览" id="douban-cover-img-${section}" referrerpolicy="no-referrer">
              <button class="btn btn-sm btn-outline" onclick="clearCover('${section}')">✕ 移除</button>
            </div>
            <div class="douban-form-row">
              <select class="douban-select" id="douban-status-${section}">
                <option value="wish">想看</option>
                <option value="watching">在看</option>
                <option value="watched">已看</option>
              </select>
              <div class="douban-star-select" id="douban-rating-${section}">
                ${[1,2,3,4,5].map(i => `<span data-rating="${i}" onclick="setDoubanRating('${section}',${i})">☆</span>`).join('')}
              </div>
            </div>
            <textarea class="douban-review" id="douban-review-${section}" rows="2" placeholder="我的评价..."></textarea>
            <div class="douban-form-actions">
              <button class="btn btn-primary btn-sm" onclick="addDoubanItem('${section}')" id="douban-add-btn-${section}">添加</button>
            </div>
          </div>
        </div>`;
      textarea.insertAdjacentHTML('afterend', doubanHTML);
      // Auto-show cover preview when user pastes a URL
      document.getElementById(`douban-cover-input-${section}`).addEventListener('input', function() {
        const val = this.value.trim();
        if (val) {
          document.getElementById(`douban-cover-img-${section}`).src = val;
          document.getElementById(`douban-cover-${section}`).style.display = 'flex';
        } else {
          document.getElementById(`douban-cover-${section}`).style.display = 'none';
        }
      });
    }
  }
}

function previewMarkdown(section) {
  const body = document.getElementById(`body-editor-${section}`).value;
  const preview = document.getElementById(`preview-${section}`);
  if (!preview) return;
  preview.classList.toggle('show');
  if (preview.classList.contains('show')) {
    try { preview.innerHTML = typeof marked !== 'undefined' ? marked.parse(body) : body; } catch { preview.innerHTML = body; }
  }
}

function uploadImage(section) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('图片不能超过 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const textarea = document.getElementById(`body-editor-${section}`);
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const imgTag = `<img src="${reader.result}" alt="${file.name}" style="max-width:100%">`;
      textarea.value = textarea.value.substring(0, start) + imgTag + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + imgTag.length;
      textarea.focus();
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ===== Douban-style movies/books =====
const STATUS_LABEL = { wish: '想看', watching: '在看', watched: '已看' };
const STATUS_ICON = { wish: '⏳', watching: '📖', watched: '✅' };

function renderDoubanDisplay(container, section, items, sectionTitle) {
  let html = '';
  if (sectionTitle) html += `<h1>${escapeHtml(sectionTitle)}</h1><hr>`;
  if (!items || !items.length) {
    html += '<div class="empty-state"><p>暂无内容</p></div>';
    container.innerHTML = html;
    return;
  }

  const counts = { wish: 0, watching: 0, watched: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;

  html += `<div class="douban-tabs">`;
  for (const s of ['wish', 'watching', 'watched']) {
    html += `<button class="douban-tab${s === 'wish' ? ' active' : ''}" onclick="switchDoubanTab('${section}','${s}')">${STATUS_ICON[s]} ${STATUS_LABEL[s]} <span class="douban-count">${counts[s] || 0}</span></button>`;
  }
  html += `</div>`;
  html += `<div class="douban-grid" id="douban-grid-${section}">`;
  for (const item of items) {
    if (item.status === 'wish') html += renderDoubanCard(item);
  }
  html += `</div>`;
  container.innerHTML = html;
}

function renderDoubanCard(item) {
  const title = escapeHtml(item.title || '未命名');
  const url = item.url || '';
  const cover = item.cover || '';
  const titleHTML = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="douban-link">${title} 🔗</a>`
    : `<span class="douban-title">${title}</span>`;
  const stars = '★'.repeat(Math.min(Math.max(item.rating || 0, 0), 5));
  const empty = '☆'.repeat(5 - stars.length);
  const review = item.review ? `<p class="douban-review">${escapeHtml(item.review)}</p>` : '';
  const coverHTML = cover ? `<div class="douban-cover"><img src="${escapeHtml(cover)}" alt="${title}" loading="lazy" referrerpolicy="no-referrer"></div>` : '';
  return `<div class="douban-card">${coverHTML}<div class="douban-card-body"><div class="douban-card-title">${titleHTML}</div><div class="douban-stars">${stars}${empty}</div>${review}</div></div>`;
}

function switchDoubanTab(section, status) {
  const tabs = document.querySelectorAll(`#section-${section} .douban-tab`);
  tabs.forEach(t => t.classList.toggle('active', t.textContent.includes(STATUS_LABEL[status])));
  const grid = document.getElementById(`douban-grid-${section}`);
  if (!grid) return;
  try {
    const items = JSON.parse((state.contentCache[section] || {}).body || '[]');
    if (!Array.isArray(items)) return;
    grid.innerHTML = items.filter(i => i.status === status).map(renderDoubanCard).join('');
  } catch {}
}

function startDoubanEdit(section) {
  const data = state.contentCache[section] || {};
  state.doubanItems[section] = [];
  try {
    const parsed = JSON.parse(data.body || '[]');
    if (Array.isArray(parsed)) state.doubanItems[section] = parsed;
  } catch {}
  state.doubanCurrentRating[section] = 0;
  state.doubanEditIndex[section] = -1;

  document.getElementById(`title-${section}`).value = data.title || '';
  document.getElementById(`body-${section}`).style.display = 'none';
  document.getElementById(`editor-${section}`).style.display = 'block';
  document.getElementById(`body-editor-${section}`).style.display = 'none';
  document.getElementById(`douban-editor-${section}`).style.display = 'block';
  renderDoubanItemList(section);
  resetDoubanForm(section);
}

function renderDoubanItemList(section) {
  const list = document.getElementById(`douban-list-${section}`);
  if (!list) return;
  const items = state.doubanItems[section] || [];
  if (!items.length) {
    list.innerHTML = '<p class="empty-state" style="padding:12px">暂无项目</p>';
    return;
  }
  list.innerHTML = items.map((item, idx) => `
    <div class="douban-editor-item">
      ${item.cover ? `<img src="${escapeHtml(item.cover)}" class="douban-editor-thumb" alt="" referrerpolicy="no-referrer">` : ''}
      <div class="douban-editor-item-info">
        <strong>${escapeHtml(item.title || '未命名')}</strong>
        ${item.url ? ` <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="douban-link">🔗</a>` : ''}
        <span class="douban-editor-badge">${STATUS_LABEL[item.status]}</span>
        <span>${'★'.repeat(Math.min(Math.max(item.rating||0,0),5))}${'☆'.repeat(5-Math.min(Math.max(item.rating||0,0),5))}</span>
      </div>
      <div class="douban-editor-item-actions">
        <button class="btn btn-sm btn-outline" onclick="editDoubanItem('${section}',${idx})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDoubanItem('${section}',${idx})">删除</button>
      </div>
    </div>`).join('');
}

function resetDoubanForm(section) {
  document.getElementById(`douban-title-${section}`).value = '';
  document.getElementById(`douban-url-${section}`).value = '';
  document.getElementById(`douban-cover-input-${section}`).value = '';
  document.getElementById(`douban-cover-${section}`).style.display = 'none';
  document.getElementById(`douban-status-${section}`).value = 'wish';
  document.getElementById(`douban-review-${section}`).value = '';
  state.doubanCurrentRating[section] = 0;
  state.doubanEditIndex[section] = -1;
  document.getElementById(`douban-add-btn-${section}`).textContent = '添加';
  const stars = document.querySelectorAll(`#douban-rating-${section} span`);
  stars.forEach(s => s.textContent = '☆');
}

function setDoubanRating(section, rating) {
  state.doubanCurrentRating[section] = rating;
  const stars = document.querySelectorAll(`#douban-rating-${section} span`);
  stars.forEach((s, i) => { s.textContent = i < rating ? '★' : '☆'; });
}

function addDoubanItem(section) {
  const title = document.getElementById(`douban-title-${section}`).value.trim();
  if (!title) { alert('请输入标题'); return; }
  const item = {
    title,
    url: document.getElementById(`douban-url-${section}`).value.trim(),
    cover: document.getElementById(`douban-cover-input-${section}`).value.trim(),
    status: document.getElementById(`douban-status-${section}`).value,
    rating: state.doubanCurrentRating[section] || 0,
    review: document.getElementById(`douban-review-${section}`).value.trim()
  };
  const editIdx = state.doubanEditIndex[section];
  if (editIdx >= 0 && editIdx < state.doubanItems[section].length) {
    state.doubanItems[section][editIdx] = item;
  } else {
    state.doubanItems[section].push(item);
  }
  renderDoubanItemList(section);
  resetDoubanForm(section);
}

function editDoubanItem(section, idx) {
  const item = state.doubanItems[section][idx];
  if (!item) return;
  document.getElementById(`douban-title-${section}`).value = item.title || '';
  document.getElementById(`douban-url-${section}`).value = item.url || '';
  document.getElementById(`douban-cover-input-${section}`).value = item.cover || '';
  if (item.cover) {
    document.getElementById(`douban-cover-img-${section}`).src = item.cover;
    document.getElementById(`douban-cover-${section}`).style.display = 'flex';
  } else {
    document.getElementById(`douban-cover-${section}`).style.display = 'none';
  }
  document.getElementById(`douban-status-${section}`).value = item.status || 'wish';
  document.getElementById(`douban-review-${section}`).value = item.review || '';
  state.doubanCurrentRating[section] = item.rating || 0;
  state.doubanEditIndex[section] = idx;
  document.getElementById(`douban-add-btn-${section}`).textContent = '保存修改';
  setDoubanRating(section, item.rating || 0);
}

function deleteDoubanItem(section, idx) {
  state.doubanItems[section].splice(idx, 1);
  renderDoubanItemList(section);
}

async function fetchCover(section) {
  const url = document.getElementById(`douban-url-${section}`).value.trim();
  if (!url) { alert('请先输入豆瓣链接'); return; }
  const btn = document.querySelector(`#douban-editor-${section} [onclick*="fetchCover"]`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const data = await api('fetch-cover', { method: 'POST', body: JSON.stringify({ url }) });
    if (data.cover) {
      document.getElementById(`douban-cover-input-${section}`).value = data.cover;
      document.getElementById(`douban-cover-img-${section}`).src = data.cover;
      document.getElementById(`douban-cover-${section}`).style.display = 'flex';
    } else {
      alert('未找到封面，可手动输入封面图片URL');
    }
  } catch (err) {
    alert('获取失败，请手动输入封面图片URL');
  }
  if (btn) { btn.textContent = '🖼️'; btn.disabled = false; }
}

function clearCover(section) {
  document.getElementById(`douban-cover-input-${section}`).value = '';
  document.getElementById(`douban-cover-${section}`).style.display = 'none';
}

// ===== Douban Search =====
function searchDoubanItem(section) {
  const title = document.getElementById(`douban-title-${section}`).value.trim();
  if (!title) { alert('请先输入电影名称'); return; }
  window.open(`https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(title)}`, '_blank');
}

document.addEventListener('DOMContentLoaded', init);
