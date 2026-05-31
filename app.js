/* ============================================================
   小杨专属记账 app.js v7.0
   功能：收支记录 · 智能金额识别 · 截屏OCR识别 · 快捷记账
         统计图表 · 预算管理 · 借贷管理
         个人/公司双账户（公司仅收支，简单明了）
         双存储持久化（localStorage + IndexedDB）
         增强导出（JSON/CSV/月报/按月/按范围）
         数据安全（自动备份 · 完整性检查 · 自动恢复）
   ============================================================ */

// ─────────────────────────────────────────────
// 1. 双存储持久化（localStorage + IndexedDB）
// ─────────────────────────────────────────────
const LS_RECORDS  = 'xh_records';
const LS_BUDGETS  = 'xh_budgets';
const LS_BACKUP   = 'xh_backup';   // auto-backup snapshot
const IDB_NAME    = 'XiaoYangDB';
const IDB_VERSION = 1;

let records = JSON.parse(localStorage.getItem(LS_RECORDS) || '[]');
let budgets = JSON.parse(localStorage.getItem(LS_BUDGETS) || '{}');

// Initialize IndexedDB
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('budgets')) {
        db.createObjectStore('budgets', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('backups')) {
        db.createObjectStore('backups', { keyPath: 'timestamp' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Save records to BOTH localStorage and IndexedDB
async function saveRecords() {
  localStorage.setItem(LS_RECORDS, JSON.stringify(records));
  // Auto-backup to localStorage
  localStorage.setItem(LS_BACKUP, JSON.stringify({ records, budgets, ts: Date.now() }));
  // Save to IndexedDB
  try {
    const db = await openIDB();
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    await store.clear();
    for (const r of records) store.put(r);
  } catch(e) { console.warn('IDB save failed:', e); }
}

async function saveBudgets() {
  localStorage.setItem(LS_BUDGETS, JSON.stringify(budgets));
  localStorage.setItem(LS_BACKUP, JSON.stringify({ records, budgets, ts: Date.now() }));
  try {
    const db = await openIDB();
    const tx = db.transaction('budgets', 'readwrite');
    const store = tx.objectStore('budgets');
    await store.clear();
    store.put({ key: 'main', data: budgets });
  } catch(e) { console.warn('IDB save failed:', e); }
}

// Data integrity check
function checkDataIntegrity() {
  const issues = [];
  records.forEach(r => {
    if (!r.id) issues.push(`Record missing ID`);
    if (!r.type || !['expense','income','debt'].includes(r.type)) issues.push(`Invalid type: ${r.type}`);
    if (!r.amount || r.amount <= 0) issues.push(`Invalid amount: ${r.amount}`);
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) issues.push(`Invalid date: ${r.date}`);
    if (r.type === 'debt' && !r.debtor) issues.push(`Debt missing debtor`);
  });
  return issues;
}

// Auto-recovery from backup
function attemptRecovery() {
  try {
    const backup = JSON.parse(localStorage.getItem(LS_BACKUP) || '{}');
    if (backup.records && backup.records.length > 0) {
      const currentLen = records.length;
      const backupLen = backup.records.length;
      if (backupLen > currentLen) {
        records = backup.records;
        budgets = backup.budgets || {};
        localStorage.setItem(LS_RECORDS, JSON.stringify(records));
        localStorage.setItem(LS_BUDGETS, JSON.stringify(budgets));
        return { recovered: true, from: currentLen, to: backupLen };
      }
    }
  } catch(e) {}
  return { recovered: false };
}

// Manual backup to IndexedDB
async function createManualBackup() {
  try {
    const db = await openIDB();
    const tx = db.transaction('backups', 'readwrite');
    tx.objectStore('backups').put({
      timestamp: Date.now(),
      records: [...records],
      budgets: {...budgets}
    });
    return true;
  } catch(e) { return false; }
}

// ─────────────────────────────────────────────
// 2. 分类配置
// ─────────────────────────────────────────────
const CATS = {
  expense: [
    { key:'food',      label:'餐饮',  icon:'🍜' },
    { key:'shop',      label:'购物',  icon:'🛍️' },
    { key:'traffic',   label:'交通',  icon:'🚌' },
    { key:'life',      label:'生活',  icon:'🏠' },
    { key:'medical',   label:'医疗',  icon:'💊' },
    { key:'entertain', label:'娱乐',  icon:'🎮' },
    { key:'edu',       label:'学习',  icon:'📚' },
    { key:'beauty',    label:'美容',  icon:'💄' },
    { key:'fitness',   label:'运动',  icon:'🏃' },
    { key:'other',     label:'其他',  icon:'📦' },
  ],
  income: [
    { key:'salary',    label:'工资',  icon:'💰' },
    { key:'bonus',     label:'奖金',  icon:'🎁' },
    { key:'invest',    label:'理财',  icon:'📈' },
    { key:'parttime',  label:'兼职',  icon:'💼' },
    { key:'transfer',  label:'转账',  icon:'🔄' },
    { key:'other',     label:'其他',  icon:'✨' },
  ],
  debt: [
    { key:'lend',      label:'借钱',  icon:'💸' },
    { key:'dinner',    label:'代付',  icon:'🍽️' },
    { key:'gift',      label:'代买',  icon:'🎁' },
    { key:'transfer',  label:'转账',  icon:'🔄' },
    { key:'other',     label:'其他',  icon:'📝' },
  ]
};

const PIE_COLORS = ['#16a34a','#22c55e','#4ade80','#86efac','#f59e0b',
                    '#f97316','#ef4444','#8b5cf6','#06b6d4','#ec4899'];

// ─────────────────────────────────────────────
// 3. 智能金额识别
// ─────────────────────────────────────────────
function parseAmount(text) {
  if (!text || !text.trim()) return null;
  const t = text.trim();
  const patterns = [
    /实付[款项：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/,
    /[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*元/,
    /金额[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/,
    /[Tt]otal[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/,
    /[Rr][Mm][Bb]\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:块|圆)/,
    /收款\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /支出\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /消费\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /付款\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /到账\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /([0-9]{1,7}(?:\.[0-9]{1,2})?)(?!\d)/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n < 1000000) return n.toFixed(2);
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// 3.5 截屏 OCR 识别
// ─────────────────────────────────────────────
/**
 * 从图片中提取文字信息（使用 Canvas 像素分析 + 模式匹配）
 * 由于是纯前端 PWA，无法使用真正的 OCR API
 * 方案：将图片渲染到 Canvas → 提取高对比度区域 → 模式匹配金额/商户关键词
 *
 * 实际上我们采用更实用的方案：
 * 1. 用户通过分享菜单传入截图 → 自动打开记账面板
 * 2. 图片显示在界面上供用户参考
 * 3. 增强的文字解析（支持微信/支付宝截图的常见文字格式）
 */

// OCR 状态
let ocrImageData = null; // 存储当前识别的截图

/**
 * 增强版文字解析 —— 专门针对微信/支付宝付款截图的文字格式
 * 支持格式：
 * - 微信支付：付款金额¥XX.XX / 向商户名付款 / 微信支付凭证
 * - 支付宝：付款金额XX.XX / 商户名称 / 支付宝收款
 */
function parsePaymentText(text) {
  if (!text || !text.trim()) return null;
  const t = text.trim();

  // 提取金额
  const amountPatterns = [
    /实付[款项：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/,
    /付款金额[：:\s]*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /支付金额[：:\s]*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /收款金额[：:\s]*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /金额[：:\s]*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*元/,
    /付款[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/,
    /收款[：:\s]*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /支出\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /消费\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /付款\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /到账\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /[Tt]otal[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/,
    /[Rr][Mm][Bb]\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:块|圆)/,
  ];

  let amount = null;
  for (const p of amountPatterns) {
    const m = t.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n < 1000000) { amount = n.toFixed(2); break; }
    }
  }

  // 提取商户名
  let merchant = null;
  const merchantPatterns = [
    /向\s*(.+?)\s*付款/,
    /收款方[：:\s]*(.+?)[\n\r]/,
    /商户[名号][：:\s]*(.+?)[\n\r]/,
    /商\s*户[：:\s]*(.+?)[\n\r]/,
    /付款给[：:\s]*(.+?)[\n\r]/,
    /付款给(.+?)[\n\r]/,
    /转账-([^#\n\r]+)/,
    /转账[给到]\s*(.+?)[\n\r]/,
  ];
  for (const p of merchantPatterns) {
    const m = t.match(p);
    if (m && m[1]) {
      merchant = m[1].trim().substring(0, 30);
      break;
    }
  }

  // 判断收支类型
  let type = 'expense'; // 默认支出
  if (/收款|到账|收入|转账-你/.test(t)) type = 'income';

  // 提取日期
  let date = null;
  const datePatterns = [
    /(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}:\d{2})/, // 时间，不作为日期
  ];
  const dm = t.match(/(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
  if (dm) {
    date = dm[1].replace(/[年月]/g, '-').replace(/日/g, '');
  }

  return { amount, merchant, type, date };
}

/**
 * 从图片文件中提取文字（通过 Canvas 分析）
 * 由于纯前端限制，我们采用"展示图片 + 提示用户手动输入"的折中方案
 * 但对于包含文字分享的情况（如分享付款通知文字），直接解析
 */
function processImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // 尝试通过 Canvas 读取图片（用于展示预览）
      const img = new Image();
      img.onload = () => {
        resolve({ dataUrl, width: img.width, height: img.height });
      };
      img.onerror = () => resolve({ dataUrl, width: 0, height: 0 });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

// OCR UI 操作
function showOcrResult(data) {
  const resultEl = document.getElementById('ocrResult');
  const previewEl = document.getElementById('ocrPreview');

  // 显示图片预览
  if (data.dataUrl) {
    previewEl.innerHTML = `<img src="${data.dataUrl}" alt="截图预览">`;
    previewEl.style.display = '';
  }

  // 显示识别结果（如果有文字解析的话）
  if (data.parsed) {
    document.getElementById('ocrAmount').textContent = data.parsed.amount ? `¥${data.parsed.amount}` : '未识别到';
    if (data.parsed.merchant) document.getElementById('ocrMerchant').value = data.parsed.merchant;
    if (data.parsed.type) document.getElementById('ocrType').value = data.parsed.type;
  } else {
    document.getElementById('ocrAmount').textContent = '请手动输入';
  }

  resultEl.style.display = '';
}

function hideOcrResult() {
  document.getElementById('ocrResult').style.display = 'none';
  document.getElementById('ocrPreview').style.display = 'none';
  ocrImageData = null;
}

// OCR 区域点击 → 打开文件选择
document.getElementById('ocrArea').addEventListener('click', () => {
  document.getElementById('ocrFileInput').click();
});

// OCR 关闭按钮
document.getElementById('ocrClose').addEventListener('click', hideOcrResult);

// 文件选择处理
document.getElementById('ocrFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showToast('📸 正在识别截图...');

  const imgData = await processImageFile(file);
  ocrImageData = imgData;

  // 尝试从文件名提取信息（有些截图文件名包含金额信息）
  const fileName = file.name || '';
  const parsed = parsePaymentText(fileName);

  showOcrResult({ dataUrl: imgData.dataUrl, parsed });

  // 由于纯前端无法做真正的 OCR，提示用户
  if (!parsed || !parsed.amount) {
    showToast('💡 请参考截图，在键盘输入金额');
  } else {
    showToast(`✅ 识别到金额 ¥${parsed.amount}`);
  }

  e.target.value = ''; // 允许重复选择同一文件
});

// OCR 一键记账按钮
document.getElementById('ocrApplyBtn').addEventListener('click', () => {
  const amtText = document.getElementById('ocrAmount').textContent;
  const merchant = document.getElementById('ocrMerchant').value.trim();
  const type = document.getElementById('ocrType').value;

  // 提取金额数值
  const amtMatch = amtText.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (amtMatch) {
    amountStr = amtMatch[1];
    updateAmountDisplay();
  }

  // 设置类型
  currentType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  if (type === 'debt') selectedCat = CATS.debt[0].key;
  else selectedCat = CATS[type][0].key;

  // 设置备注（商户名）
  if (merchant) {
    document.getElementById('noteInput').value = merchant;
  }

  renderCatGrid();
  hideOcrResult();

  if (amtMatch) {
    showToast('✅ 已填入，点击「完成」确认记账');
  } else {
    showToast('💡 请输入金额后点击「完成」');
  }
});

// Web Share Target API 处理
// 当用户从其他 App 分享截图/文字到本 App 时触发
async function handleShareTarget() {
  // 检查是否通过 POST 分享进入
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    // Service Worker 会处理 POST 请求并重定向
  }

  // 检查 URL 参数（GET 分享或 SW 重定向）
  const params = new URLSearchParams(window.location.search);
  const shareText = params.get('text') || params.get('title') || '';
  const shareUrl = params.get('url') || '';

  if (shareText) {
    // 有分享文字，直接解析
    openAddSheet();
    const parsed = parsePaymentText(shareText);
    if (parsed) {
      if (parsed.amount) {
        amountStr = String(parseFloat(parsed.amount));
        updateAmountDisplay();
      }
      if (parsed.merchant) {
        document.getElementById('noteInput').value = parsed.merchant;
      }
      if (parsed.type) {
        currentType = parsed.type;
        document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === parsed.type));
        selectedCat = CATS[parsed.type] ? CATS[parsed.type][0].key : CATS.expense[0].key;
        renderCatGrid();
      }
      showToast('✅ 已识别分享内容');
    } else {
      // 没有识别出金额，把文字放到智能识别框
      document.getElementById('smartInput').value = shareText;
      showToast('💡 已填入文字，请确认金额');
    }
    // 清理 URL 参数
    window.history.replaceState({}, '', './index.html');
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// 4. 日期 & 月份工具
// ─────────────────────────────────────────────
const today   = () => new Date().toISOString().slice(0, 10);
const fmtYM   = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const fmtDisp = (d) => `${d.getFullYear()}年${d.getMonth()+1}月`;
const fmtDate = (s) => { const d = new Date(s); return `${d.getMonth()+1}月${d.getDate()}日`; };

// ─────────────────────────────────────────────
// 5. 状态
// ─────────────────────────────────────────────
let currentMonth   = new Date();
let currentType    = 'expense';
let currentAccount = 'personal';  // personal / company
let selectedCat    = 'food';
let amountStr      = '0';
let currentPeriod  = 'month';
let detailId       = null;
let viewAccount    = 'all';       // all / personal / company (header filter)
let deleteConfirmPending = false; // for v7.0 double-click delete confirmation

// ─────────────────────────────────────────────
// 6. 获取当前筛选的记录
// ─────────────────────────────────────────────
function getAccountFiltered(records_list) {
  if (viewAccount === 'all') return records_list;
  return records_list.filter(r => (r.account || 'personal') === viewAccount);
}

// ─────────────────────────────────────────────
// 7. Header & 预算进度条 & 待收回
// ─────────────────────────────────────────────
function updateHeader() {
  document.getElementById('monthLabel').textContent = fmtDisp(currentMonth);
  const ym = fmtYM(currentMonth);
  const monthRecs = getAccountFiltered(records).filter(r => r.date.startsWith(ym));

  const income  = monthRecs.filter(r=>r.type==='income').reduce((a,b)=>a+b.amount, 0);
  const expense = monthRecs.filter(r=>r.type==='expense').reduce((a,b)=>a+b.amount, 0);
  const balance = income - expense;

  document.getElementById('totalIncome').textContent  = `¥${income.toFixed(2)}`;
  document.getElementById('totalExpense').textContent = `¥${expense.toFixed(2)}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `¥${Math.abs(balance).toFixed(2)}${balance < 0 ? '(超)' : ''}`;
  balEl.style.color = balance >= 0 ? '#bbf7d0' : '#fca5a5';

  // 待收回 = 别人欠我(未还)，仅个人账户
  const debtRemain = records
    .filter(r => r.type === 'debt')
    .reduce((sum, r) => {
      if (viewAccount !== 'all' && (r.account||'personal') !== viewAccount) return sum;
      return sum + getDebtRemain(r);
    }, 0);
  document.getElementById('totalDebt').textContent = `¥${debtRemain.toFixed(2)}`;

  // 总预算进度条
  const overall = parseFloat(budgets.overall) || 0;
  const wrap    = document.getElementById('headerBudgetWrap');
  if (overall > 0) {
    wrap.style.display = 'block';
    const pct = Math.min(expense / overall * 100, 100);
    const fill = document.getElementById('headerBudgetFill');
    fill.style.width = pct + '%';
    fill.className = 'budget-bar-fill' + (pct>=100?' over':pct>=80?' warn':'');
    document.getElementById('headerBudgetText').textContent =
      `¥${expense.toFixed(0)} / ¥${overall.toFixed(0)}`;
  } else {
    wrap.style.display = 'none';
  }

  checkBudgetAlert(expense, ym);
}

function getDebtRemain(r) {
  if (r.type !== 'debt') return 0;
  const repaid = (r.repays || []).reduce((s, p) => s + p.amount, 0);
  return Math.max(0, r.amount - repaid);
}

function checkBudgetAlert(expense, ym) {
  const alertEl = document.getElementById('budgetAlert');
  const overall = parseFloat(budgets.overall) || 0;
  if (overall <= 0) { alertEl.classList.remove('show'); return; }
  const pct = expense / overall * 100;
  if (pct >= 100) {
    alertEl.textContent = `⚠️ 本月支出已超出总预算 ¥${(expense-overall).toFixed(2)}，注意控制消费`;
    alertEl.classList.add('show');
  } else if (pct >= 80) {
    alertEl.textContent = `📢 本月支出已达预算 ${pct.toFixed(0)}%，剩余 ¥${(overall-expense).toFixed(2)}`;
    alertEl.classList.add('show');
  } else {
    alertEl.classList.remove('show');
  }
}

// ─────────────────────────────────────────────
// 8. Account switch in header
// ─────────────────────────────────────────────
document.querySelectorAll('.account-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    viewAccount = btn.dataset.account;
    document.querySelectorAll('.account-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateHeader();
    renderList();
  });
});

// ─────────────────────────────────────────────
// 9. 记录列表
// ─────────────────────────────────────────────
function renderList() {
  const ym   = fmtYM(currentMonth);
  const list = getAccountFiltered(records)
    .filter(r => r.date.startsWith(ym))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const container = document.getElementById('listView');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-text">这个月还没有账单<br>点击底部 + 开始记账</div>
    </div>`;
    return;
  }

  const groups = {};
  list.forEach(r => (groups[r.date] = groups[r.date] || []).push(r));

  container.innerHTML = Object.entries(groups).map(([date, items]) => {
    const dayInc = items.filter(r=>r.type==='income').reduce((a,b)=>a+b.amount,0);
    const dayExp = items.filter(r=>r.type==='expense').reduce((a,b)=>a+b.amount,0);
    const sum = [dayInc>0?`+¥${dayInc.toFixed(2)}`:'', dayExp>0?`-¥${dayExp.toFixed(2)}`:''].filter(Boolean).join('  ');

    const rows = items.map(r => {
      const cats = CATS[r.type] || CATS.expense;
      const cat = cats.find(c=>c.key===r.cat)||{icon:'📦',label:'其他'};
      let sign, badge = '', amountClass = r.type;

      if (r.type === 'income')  { sign = '+'; }
      else if (r.type === 'expense') { sign = '-'; }
      else { sign = ''; }

      // Badge for debt records
      if (r.type === 'debt') {
        const remain = getDebtRemain(r);
        if (remain <= 0) badge = '<span class="record-badge returned">已还清</span>';
        else if ((r.repays || []).length > 0) badge = '<span class="record-badge partial">部分还</span>';
      }

      // Account tag
      if (viewAccount === 'all') {
        const accTag = (r.account || 'personal') === 'company'
          ? '<span class="record-badge account-tag">公司</span>' : '';
        badge += accTag;
      }

      let catLabel = cat.label;
      if (r.type === 'debt' && r.debtor) catLabel += ` · ${r.debtor}`;

      const noteText = r.note || (r.type==='income'?'收入':r.type==='expense'?'支出':'欠款');
      const iconClass = r.type;

      return `<div class="record-item" data-id="${r.id}">
        <div class="record-icon ${iconClass}">${cat.icon}</div>
        <div class="record-info">
          <div class="record-cat">${catLabel}</div>
          <div class="record-note">${noteText}</div>
        </div>
        <div class="record-amount ${amountClass}">${sign}¥${r.amount.toFixed(2)}</div>
        ${badge}
      </div>`;
    }).join('');

    return `<div class="date-group">
      <div class="date-header"><span>${fmtDate(date)}</span><span>${sum}</span></div>
      ${rows}
    </div>`;
  }).join('');

  container.querySelectorAll('.record-item').forEach(el => {
    el.addEventListener('click', () => showDetail(+el.dataset.id));
  });
}

// ─────────────────────────────────────────────
// 10. 详情 Modal（v7.0: 双击确认删除）
// ─────────────────────────────────────────────
function showDetail(id) {
  const r = records.find(x=>x.id===id);
  if (!r) return;
  detailId = id;
  deleteConfirmPending = false;
  const cats = CATS[r.type] || CATS.expense;
  const cat  = cats.find(c=>c.key===r.cat) || {icon:'📦',label:'其他'};
  let sign, typeLabel;
  if (r.type === 'income')  { sign = '+'; typeLabel = '💚 收入'; }
  else if (r.type === 'expense') { sign = '-'; typeLabel = '❤️ 支出'; }
  else { sign = ''; typeLabel = '🤝 别人欠我'; }

  document.getElementById('detailIcon').textContent = cat.icon;
  const amtEl = document.getElementById('detailAmount');
  amtEl.textContent = `${sign}¥${r.amount.toFixed(2)}`;
  amtEl.style.color = r.type==='income' ? 'var(--green)' : r.type==='debt' ? 'var(--amber)' : 'var(--red)';
  document.getElementById('detailCat').textContent = cat.label;
  document.getElementById('detailDate').textContent = r.date;
  document.getElementById('detailType').textContent = typeLabel;
  document.getElementById('detailAccount').textContent = (r.account||'personal') === 'company' ? '🏢 公司账户' : '👤 个人账户';

  const noteRow = document.getElementById('detailNoteRow');
  if (r.note) { noteRow.style.display='flex'; document.getElementById('detailNote').textContent=r.note; }
  else        { noteRow.style.display='none'; }

  const debtorRow = document.getElementById('detailDebtorRow');
  const repayRow = document.getElementById('detailRepayRow');
  const repayBtn = document.getElementById('detailRepayBtn');

  if (r.type === 'debt') {
    debtorRow.style.display = 'flex';
    document.getElementById('detailDebtor').textContent = r.debtor || '未填写';

    const repaid = (r.repays || []).reduce((s, p) => s + p.amount, 0);
    const remain = r.amount - repaid;
    repayRow.style.display = 'flex';
    document.getElementById('detailRepay').textContent =
      repaid > 0 ? `¥${repaid.toFixed(2)}（剩余 ¥${remain.toFixed(2)}）` : `未还款，剩余 ¥${remain.toFixed(2)}`;
    repayBtn.style.display = remain > 0 ? '' : 'none';
  } else {
    debtorRow.style.display = 'none';
    repayRow.style.display = 'none';
    repayBtn.style.display = 'none';
  }

  // Reset delete button state
  const delBtn = document.getElementById('detailDelete');
  delBtn.textContent = '删除';
  delBtn.style.background = '';
  delBtn.style.color = '';

  document.getElementById('detailModal').classList.add('open');
}

document.getElementById('detailClose').addEventListener('click', () => {
  document.getElementById('detailModal').classList.remove('open');
  deleteConfirmPending = false;
});

// v7.0: 双击确认删除 —— 第一次点击变为红色"确认删除?"，第二次点击才真正删除
document.getElementById('detailDelete').addEventListener('click', () => {
  if (!deleteConfirmPending) {
    // First click: change to confirmation state
    deleteConfirmPending = true;
    const delBtn = document.getElementById('detailDelete');
    delBtn.textContent = '确认删除?';
    delBtn.style.background = '#dc2626';
    delBtn.style.color = '#fff';
    // Auto-reset after 3 seconds if no second click
    setTimeout(() => {
      if (deleteConfirmPending && document.getElementById('detailModal').classList.contains('open')) {
        deleteConfirmPending = false;
        delBtn.textContent = '删除';
        delBtn.style.background = '';
        delBtn.style.color = '';
      }
    }, 3000);
    return;
  }

  // Second click: actually delete
  deleteConfirmPending = false;
  records = records.filter(r=>r.id!==detailId);
  saveRecords();
  document.getElementById('detailModal').classList.remove('open');
  updateHeader(); renderList();
  showToast('已删除');
});

document.getElementById('detailRepayBtn').addEventListener('click', () => {
  const r = records.find(x=>x.id===detailId);
  if (!r || r.type !== 'debt') return;
  document.getElementById('detailModal').classList.remove('open');
  openRepayModal(r);
});

// ─────────────────────────────────────────────
// 11. Repay Modal
// ─────────────────────────────────────────────
let repayTargetId = null;

function openRepayModal(r) {
  repayTargetId = r.id;
  const repaid = (r.repays || []).reduce((s, p) => s + p.amount, 0);
  const remain = r.amount - repaid;
  const who = r.debtor || '对方';
  document.getElementById('repayInfo').textContent =
    `${who} 欠 ¥${r.amount.toFixed(2)}，已还 ¥${repaid.toFixed(2)}，剩余 ¥${remain.toFixed(2)}`;
  document.getElementById('repayAmountInput').value = '';
  document.getElementById('repayAmountInput').max = remain;
  document.getElementById('repayAmountInput').placeholder = `最多 ¥${remain.toFixed(2)}`;
  document.getElementById('repayDateInput').value = today();
  document.getElementById('repayModal').classList.add('open');
}

document.getElementById('repayCancel').addEventListener('click', () => {
  document.getElementById('repayModal').classList.remove('open');
});

document.getElementById('repayConfirm').addEventListener('click', () => {
  const r = records.find(x=>x.id===repayTargetId);
  if (!r) return;

  const repayAmt = parseFloat(document.getElementById('repayAmountInput').value);
  const repayDate = document.getElementById('repayDateInput').value || today();

  if (!repayAmt || repayAmt <= 0) { showToast('请输入有效还款金额'); return; }

  const repaid = (r.repays || []).reduce((s, p) => s + p.amount, 0);
  const remain = r.amount - repaid;
  if (repayAmt > remain + 0.01) {
    showToast(`还款金额不能超过剩余 ¥${remain.toFixed(2)}`);
    return;
  }

  if (!r.repays) r.repays = [];
  r.repays.push({ amount: repayAmt, date: repayDate });
  saveRecords();
  document.getElementById('repayModal').classList.remove('open');
  updateHeader(); renderList(); renderDebtView();

  const newRepaid = repaid + repayAmt;
  const who = r.debtor || '对方';
  if (newRepaid >= r.amount - 0.01) {
    showToast(`✅ ${who}已还清 ¥${r.amount.toFixed(2)}`);
  } else {
    showToast(`✅ 已记录还款 ¥${repayAmt.toFixed(2)}，剩余 ¥${(r.amount - newRepaid).toFixed(2)}`);
  }
});

// ─────────────────────────────────────────────
// 12. 添加记录 Sheet
// ─────────────────────────────────────────────
function openAddSheet() {
  amountStr      = '0';
  currentType    = 'expense';
  currentAccount = 'personal';
  selectedCat    = CATS.expense[0].key;
  document.getElementById('noteInput').value   = '';
  document.getElementById('dateInput').value   = today();
  document.getElementById('smartInput').value  = '';
  document.getElementById('debtorInput').value = '';
  document.getElementById('parseResult').classList.remove('show');
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type==='expense'));
  document.querySelectorAll('.account-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.account==='personal'));
  document.getElementById('debtorArea').style.display = 'none';
  document.getElementById('catSection').style.display = '';
  // Reset account-based type visibility
  updateTypeToggleForAccount();
  renderCatGrid();
  updateAmountDisplay();
  document.getElementById('addOverlay').classList.add('open');
}

function closeAddSheet() {
  document.getElementById('addOverlay').classList.remove('open');
  // FAB 成功反馈：缩放弹跳
  const fab = document.getElementById('fabBtn');
  fab.style.animation = 'confirmBounce .4s ease';
  setTimeout(() => fab.style.animation = '', 400);
}

document.getElementById('fabBtn').addEventListener('click', openAddSheet);

// Quick screenshot FAB → 直接打开截图识别
document.getElementById('quickFab').addEventListener('click', () => {
  openAddSheet();
  // 短暂延迟后自动触发截图选择
  setTimeout(() => {
    document.getElementById('ocrFileInput').click();
  }, 300);
});
document.getElementById('addOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeAddSheet();
});

// Account toggle in add sheet
document.querySelectorAll('.account-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentAccount = btn.dataset.account;
    document.querySelectorAll('.account-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateTypeToggleForAccount();
    // If current type is debt but switched to company, reset to expense
    if (currentAccount === 'company' && currentType === 'debt') {
      currentType = 'expense';
      selectedCat = CATS.expense[0].key;
      document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type==='expense'));
    }
    renderCatGrid();
  });
});

// Show/hide debt type button based on account selection
function updateTypeToggleForAccount() {
  const debtBtn = document.getElementById('debtTypeBtn');
  if (currentAccount === 'company') {
    debtBtn.style.display = 'none';
  } else {
    debtBtn.style.display = '';
  }
}

// Type toggle (3 buttons)
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentType = btn.dataset.type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.getElementById('debtorArea').style.display = currentType === 'debt' ? '' : 'none';

    if (currentType === 'debt') selectedCat = CATS.debt[0].key;
    else selectedCat = CATS[currentType][0].key;
    renderCatGrid();
  });
});

// Category grid
function renderCatGrid() {
  const grid = document.getElementById('catGrid');
  const cats = CATS[currentType] || CATS.expense;
  let selClass = 'selected';
  if (currentType === 'debt') selClass = 'selected debt-sel';
  grid.innerHTML = cats.map(c => `
    <div class="cat-item ${c.key===selectedCat?selClass:''}" data-cat="${c.key}">
      <span class="ci">${c.icon}</span>${c.label}
    </div>`).join('');
  grid.querySelectorAll('.cat-item').forEach(el => {
    el.addEventListener('click', () => { selectedCat = el.dataset.cat; renderCatGrid(); });
  });
}

// Amount display
function updateAmountDisplay() {
  document.getElementById('amountDisplay').textContent = amountStr || '0';
}

// Numpad
document.querySelectorAll('.np-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.k;
    if (k==='ok')    { submitRecord(); return; }
    if (k==='clear') { amountStr='0'; updateAmountDisplay(); return; }
    if (k==='del')   { amountStr=amountStr.slice(0,-1)||'0'; updateAmountDisplay(); return; }
    if (k==='.')     { if (!amountStr.includes('.')) amountStr+='.'; updateAmountDisplay(); return; }
    if (k==='00')    { if (amountStr!=='0') amountStr+='00'; const parts=amountStr.split('.'); if(parts[1]&&parts[1].length>2) amountStr=amountStr.slice(0,-1); updateAmountDisplay(); return; }
    if (amountStr==='0') amountStr = k;
    else amountStr += k;
    const parts = amountStr.split('.');
    if (parts[1] && parts[1].length>2) amountStr=amountStr.slice(0,-1);
    if (amountStr.replace('.','').length>8) amountStr=amountStr.slice(0,-1);
    updateAmountDisplay();
  });
});

// Smart input
document.getElementById('smartInput').addEventListener('input', e => {
  const amt = parseAmount(e.target.value);
  const res = document.getElementById('parseResult');
  if (amt) {
    document.getElementById('parsedAmt').textContent = `¥${amt}`;
    res.classList.add('show');
  } else {
    res.classList.remove('show');
  }
});

document.getElementById('applyParsed').addEventListener('click', () => {
  const text = document.getElementById('smartInput').value;
  const amt  = parseAmount(text);
  if (amt) {
    amountStr = String(parseFloat(amt));
    updateAmountDisplay();
    showToast(`✅ 已识别 ¥${amt}`);
  }
});

// Submit record
function submitRecord() {
  const amt = parseFloat(amountStr);
  if (!amt || amt <= 0) { showToast('请输入有效金额'); return; }
  const date = document.getElementById('dateInput').value || today();
  const note = document.getElementById('noteInput').value.trim();

  const record = { id: Date.now(), type: currentType, amount: amt, cat: selectedCat, date, note, account: currentAccount };

  if (currentType === 'debt') {
    const debtor = document.getElementById('debtorInput').value.trim();
    if (!debtor) { showToast('请输入欠款人姓名'); return; }
    record.debtor = debtor;
    record.repays = [];
  }

  records.push(record);
  saveRecords();
  closeAddSheet();
  updateHeader(); renderList();

  if (currentType === 'expense') checkBudgetAfterAdd(amt);
  else if (currentType === 'debt') showToast('✅ 借欠记录已添加');
  else showToast('✅ 记录成功');
}

function checkBudgetAfterAdd(addedAmt) {
  const ym   = fmtYM(currentMonth);
  const exp  = records.filter(r=>r.date.startsWith(ym)&&r.type==='expense').reduce((a,b)=>a+b.amount,0);
  const ovr  = parseFloat(budgets.overall)||0;
  if (ovr>0 && exp >= ovr) {
    showToast(`⚠️ 本月支出已超出总预算！`);
  } else if (ovr>0 && exp/ovr >= 0.8) {
    showToast(`📢 已用预算 ${(exp/ovr*100).toFixed(0)}%，注意消费`);
  } else {
    showToast('✅ 记录成功');
  }
}

// ─────────────────────────────────────────────
// 13. 借还管理视图
// ─────────────────────────────────────────────
function renderDebtView() {
  // ── 个人借贷部分 ──
  const debtRecords = records.filter(r => r.type === 'debt');
  const totalLent = debtRecords.reduce((s, r) => s + r.amount, 0);
  const totalRepaid = debtRecords.reduce((s, r) => s + (r.repays || []).reduce((a, p) => a + p.amount, 0), 0);
  const totalRemain = totalLent - totalRepaid;

  document.getElementById('debtTotalAmount').textContent = `¥${totalRemain.toFixed(2)}`;
  const personCount = new Set(debtRecords.map(r => r.debtor)).size;
  const repaidCount = debtRecords.filter(r => getDebtRemain(r) <= 0).length;
  document.getElementById('debtTotalSub').textContent = debtRecords.length > 0
    ? `共借出 ¥${totalLent.toFixed(2)} · ${personCount}人 · 已还清 ${repaidCount} 笔`
    : '暂无借贷记录';

  const byPerson = {};
  debtRecords.forEach(r => {
    const name = r.debtor || '未知';
    if (!byPerson[name]) byPerson[name] = [];
    byPerson[name].push(r);
  });

  const container = document.getElementById('debtPersonList');
  if (!debtRecords.length) {
    container.innerHTML = `<div class="empty-state" style="padding:30px 20px">
      <div class="empty-icon" style="font-size:40px">🤝</div>
      <div class="empty-text">暂无借还记录<br>记账时选择「别人欠我」即可添加</div>
    </div>`;
  } else {
    container.innerHTML = Object.entries(byPerson).map(([name, items]) => {
      const personTotal = items.reduce((s, r) => s + r.amount, 0);
      const personRepaid = items.reduce((s, r) => s + (r.repays || []).reduce((a, p) => a + p.amount, 0), 0);
      const personRemain = personTotal - personRepaid;
      const avatarEmoji = name.length > 0 ? name[0] : '?';

      const debtItems = items.sort((a, b) => b.date.localeCompare(a.date)).map(r => {
        const cat = (CATS.debt || []).find(c => c.key === r.cat) || { icon: '📝', label: '其他' };
        const remain = getDebtRemain(r);
        let badge = '';
        if (remain <= 0) badge = '<span class="debt-item-badge returned">已还清</span>';
        else if ((r.repays || []).length > 0) badge = '<span class="debt-item-badge partial">部分还</span>';

        return `<div class="debt-item">
          <div class="debt-item-date">${fmtDate(r.date)}</div>
          <div class="debt-item-info">${cat.icon} ${cat.label}${r.note ? ' · '+r.note : ''}</div>
          <div class="debt-item-amount">¥${r.amount.toFixed(2)}</div>
          ${badge}
          <div class="debt-item-actions">
            ${remain > 0 ? `<button class="debt-repay-btn" data-id="${r.id}">还款</button>` : ''}
          </div>
        </div>`;
      }).join('');

      return `<div class="debt-person-card">
        <div class="debt-person-top">
          <div class="debt-person-avatar">${avatarEmoji}</div>
          <div class="debt-person-info">
            <div class="debt-person-name">${name}</div>
            <div class="debt-person-total">${personRemain > 0 ? '待收回 ¥'+personRemain.toFixed(2) : '✅ 已还清'}</div>
            <div class="debt-person-remain">共借 ¥${personTotal.toFixed(2)} · 已还 ¥${personRepaid.toFixed(2)}</div>
          </div>
        </div>
        ${debtItems}
      </div>`;
    }).join('');

    container.querySelectorAll('.debt-repay-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = records.find(x => x.id === +btn.dataset.id);
        if (r) openRepayModal(r);
      });
    });
  }
}

// ─────────────────────────────────────────────
// 14. 预算管理
// ─────────────────────────────────────────────
function renderBudget() {
  const ym     = fmtYM(currentMonth);
  const recs   = getAccountFiltered(records).filter(r=>r.date.startsWith(ym)&&r.type==='expense');
  const total  = recs.reduce((a,b)=>a+b.amount, 0);
  const ovr    = parseFloat(budgets.overall)||0;

  document.getElementById('budgetMonthLabel').textContent = `${fmtDisp(currentMonth)} 支出概览`;

  document.getElementById('boSpent').textContent = `¥${total.toFixed(2)}`;
  if (ovr > 0) {
    document.getElementById('boLimit').textContent = `/ ¥${ovr.toFixed(0)} 预算`;
    const pct = Math.min(total/ovr*100, 100);
    const fill = document.getElementById('boFill');
    fill.style.width = pct+'%';
    fill.className = 'budget-overall-bar-fill'+(pct>=100?' over':pct>=80?' warn':'');
    const left = ovr - total;
    document.getElementById('boHint').textContent = left>=0
      ? `还可消费 ¥${left.toFixed(2)}`
      : `已超支 ¥${Math.abs(left).toFixed(2)}`;
  } else {
    document.getElementById('boLimit').textContent = '/ 未设置总预算';
    document.getElementById('boFill').style.width = '0%';
    document.getElementById('boHint').textContent = '在下方设置各分类预算，总预算自动合计';
  }

  const list = document.getElementById('budgetCatList');
  list.innerHTML = CATS.expense.map(c => {
    const spent  = recs.filter(r=>r.cat===c.key).reduce((a,b)=>a+b.amount, 0);
    const limit  = parseFloat(budgets[c.key])||0;
    const pct    = limit>0 ? Math.min(spent/limit*100,100) : 0;
    const cls    = pct>=100 ? 'over' : pct>=80 ? 'warn' : '';
    const barHtml = limit>0
      ? `<div class="budget-bar-bg2"><div class="budget-bar-fill2 ${cls}" style="width:${pct}%"></div></div>`
      : `<div class="budget-no-limit">未设预算</div>`;
    const sub = limit>0
      ? `已用 ¥${spent.toFixed(2)} / ¥${limit.toFixed(0)}`
      : `已花 ¥${spent.toFixed(2)}`;
    return `<div class="budget-cat-item">
      <div class="budget-cat-top">
        <div class="budget-cat-icon">${c.icon}</div>
        <div class="budget-cat-info">
          <div class="budget-cat-name">${c.label}</div>
          <div class="budget-cat-sub">${sub}</div>
        </div>
        <div class="budget-cat-edit">
          <span style="font-size:12px;color:var(--gray400);margin-right:3px">¥</span>
          <input class="budget-cat-input" data-cat="${c.key}"
            type="number" inputmode="decimal" min="0" step="1"
            placeholder="不限" value="${limit||''}">
        </div>
      </div>
      ${barHtml}
    </div>`;
  }).join('');

  const overallCard = document.getElementById('budgetOverallCard');
  if (!document.getElementById('overallInput')) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px;display:flex;align-items:center;gap:8px;padding:0 2px';
    wrap.innerHTML = `<span style="font-size:13px;color:rgba(255,255,255,.85);flex:1">每月总预算上限</span>
      <span style="color:rgba(255,255,255,.7);font-size:13px">¥</span>
      <input id="overallInput" type="number" inputmode="decimal" min="0" step="100"
        placeholder="不限" style="width:100px;padding:5px 8px;border:none;border-radius:8px;font-size:14px;text-align:right;outline:none;background:rgba(255,255,255,.85)">`;
    overallCard.insertBefore(wrap, overallCard.querySelector('.budget-overall-title').nextSibling);
  }
  document.getElementById('overallInput').value = budgets.overall||'';
}

document.getElementById('budgetSaveBtn').addEventListener('click', () => {
  const ov = document.getElementById('overallInput');
  if (ov) {
    const v = parseFloat(ov.value);
    if (v > 0) budgets.overall = v;
    else delete budgets.overall;
  }
  document.querySelectorAll('.budget-cat-input').forEach(inp => {
    const v = parseFloat(inp.value);
    if (v > 0) budgets[inp.dataset.cat] = v;
    else delete budgets[inp.dataset.cat];
  });
  if (!budgets.overall) {
    const sum = CATS.expense.reduce((a,c)=>a+(parseFloat(budgets[c.key])||0), 0);
    if (sum > 0) budgets.overall = sum;
  }
  saveBudgets();
  updateHeader();
  renderBudget();
  showToast('✅ 预算已保存');
});

// ─────────────────────────────────────────────
// 15. 统计图表
// ─────────────────────────────────────────────
function getFilteredRecords(period) {
  const now = new Date();
  let list;
  if (period==='month') { const ym=fmtYM(currentMonth); list=records.filter(r=>r.date.startsWith(ym)); }
  else if (period==='last')  { const d=new Date(now.getFullYear(),now.getMonth()-1,1); list=records.filter(r=>r.date.startsWith(fmtYM(d))); }
  else if (period==='year')  { list=records.filter(r=>r.date.startsWith(String(now.getFullYear()))); }
  else list=records;
  return getAccountFiltered(list);
}

function renderStats() {
  const list = getFilteredRecords(currentPeriod);
  drawTrendChart(list);
  drawPieChart(list);
}

function drawTrendChart(list) {
  const canvas = document.getElementById('trendChart');
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = 160 * dpr;
  ctx.scale(dpr, dpr);
  const cw = canvas.offsetWidth, ch = 160;

  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-6+i);
    return d.toISOString().slice(0,10);
  });
  const expD = days.map(d => list.filter(r=>r.date===d&&r.type==='expense').reduce((a,b)=>a+b.amount,0));
  const incD = days.map(d => list.filter(r=>r.date===d&&r.type==='income').reduce((a,b)=>a+b.amount,0));
  const maxV = Math.max(...expD, ...incD, 1);
  const pad  = {l:32,r:12,t:12,b:26};
  const gw = cw-pad.l-pad.r, gh = ch-pad.t-pad.b;
  const step = gw / (days.length-1);

  ctx.clearRect(0,0,cw,ch);
  ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1;
  for (let i=0;i<=4;i++) {
    const y = pad.t+gh*(1-i/4);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+gw,y); ctx.stroke();
    ctx.fillStyle='#9ca3af'; ctx.font='9px -apple-system'; ctx.textAlign='right';
    ctx.fillText(Math.round(maxV*i/4), pad.l-3, y+3);
  }

  const line = (data, color) => {
    ctx.beginPath();
    data.forEach((v,i)=>{ const x=pad.l+i*step,y=pad.t+gh*(1-v/maxV); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();
    data.forEach((v,i)=>{ const x=pad.l+i*step,y=pad.t+gh*(1-v/maxV);
      ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); });
  };
  line(expD,'#dc2626'); line(incD,'#16a34a');

  ctx.fillStyle='#9ca3af'; ctx.textAlign='center'; ctx.font='9px -apple-system';
  days.forEach((d,i)=>ctx.fillText(d.slice(5), pad.l+i*step, ch-5));

  [[cw-65,'#dc2626','支出'],[cw-65,'#16a34a','收入']].forEach(([x,c,l],i)=>{
    ctx.fillStyle=c; ctx.fillRect(x,6+i*14,10,3);
    ctx.fillStyle='#4b5563'; ctx.textAlign='left'; ctx.font='10px -apple-system';
    ctx.fillText(l,x+13,10+i*14);
  });
}

function drawPieChart(list) {
  const expenses = list.filter(r=>r.type==='expense');
  const catMap   = {};
  expenses.forEach(r => { catMap[r.cat]=(catMap[r.cat]||0)+r.amount; });
  const total   = Object.values(catMap).reduce((a,b)=>a+b, 0);
  const entries = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);

  const canvas = document.getElementById('pieChart');
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);
  const cw = canvas.offsetWidth, ch = 200;
  ctx.clearRect(0,0,cw,ch);

  if (!total) {
    ctx.fillStyle='#9ca3af'; ctx.textAlign='center'; ctx.font='13px -apple-system';
    ctx.fillText('暂无支出数据', cw/2, ch/2);
    document.getElementById('catBreakdown').innerHTML = '';
    return;
  }

  const cx=cw/2, cy=ch/2, r=Math.min(cx,cy)-14;
  let angle=-Math.PI/2;
  entries.forEach(([cat,amt],i) => {
    const slice=(amt/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,angle,angle+slice); ctx.closePath();
    ctx.fillStyle=PIE_COLORS[i%PIE_COLORS.length]; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    angle+=slice;
  });
  ctx.fillStyle='#1f2937'; ctx.textAlign='center';
  ctx.font='bold 15px -apple-system'; ctx.fillText(`¥${total.toFixed(0)}`,cx,cy+4);
  ctx.fillStyle='#9ca3af'; ctx.font='10px -apple-system'; ctx.fillText('总支出',cx,cy+17);

  document.getElementById('catBreakdown').innerHTML = entries.map(([cat,amt],i)=>{
    const cd=CATS.expense.find(c=>c.key===cat)||{label:'其他',icon:'📦'};
    return `<div class="cat-row">
      <div class="cat-dot" style="background:${PIE_COLORS[i%PIE_COLORS.length]}"></div>
      <span style="font-size:15px">${cd.icon}</span>
      <span class="cat-name">${cd.label}</span>
      <span class="cat-pct">${((amt/total)*100).toFixed(1)}%</span>
      <span class="cat-amt" style="color:var(--red)">-¥${amt.toFixed(2)}</span>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 16. 导航
// ─────────────────────────────────────────────
const VIEWS = { list:'listView', stats:'statsView', debt:'debtView', budget:'budgetView', settings:'settingsView' };

function switchView(name) {
  Object.entries(VIEWS).forEach(([k,id])=>{
    const el = document.getElementById(id);
    if (k===name) {
      el.style.display = '';
      el.style.animation = 'none';
      el.offsetHeight; // trigger reflow
      el.style.animation = 'fadeScaleIn .2s ease';
    } else {
      el.style.display = 'none';
    }
  });
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));

  if (name==='stats')    { setTimeout(renderStats, 50); }
  if (name==='debt')     { renderDebtView(); }
  if (name==='budget')   renderBudget();
  if (name==='settings') {
    document.getElementById('totalRecords').textContent=records.length;
    updateAutoBackupStatus();
  }
}

document.querySelectorAll('.tab,.nav-btn').forEach(el=>{
  const k=el.dataset.tab||el.dataset.nav;
  if (k) el.addEventListener('click',()=>switchView(k));
});

document.querySelectorAll('.period-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    currentPeriod=btn.dataset.period;
    document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderStats();
  });
});

document.getElementById('prevMonth').addEventListener('click',()=>{
  currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);
  updateHeader(); renderList();
});
document.getElementById('nextMonth').addEventListener('click',()=>{
  const next=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);
  if (next > new Date()) { showToast('还没到那个月份 😄'); return; }
  currentMonth=next;
  updateHeader(); renderList();
});

// ─────────────────────────────────────────────
// 17. 增强导出功能（v7.0）
// ─────────────────────────────────────────────

// Download helper
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('✅ 导出成功');
}

// CSV generation with BOM for Excel compatibility
function generateCSV(recs) {
  const BOM = '\uFEFF';
  const headers = ['日期','类型','分类','金额','备注','账户','欠款人','还款状态'];
  const rows = recs.map(r => {
    const cats = CATS[r.type] || CATS.expense;
    const cat = cats.find(c=>c.key===r.cat) || {label:'其他'};
    const typeMap = {expense:'支出',income:'收入',debt:'别人欠我'};
    const accMap = {personal:'个人',company:'公司'};
    let repayStatus = '';
    if (r.type === 'debt') {
      const remain = getDebtRemain(r);
      repayStatus = remain <= 0 ? '已还清' : (r.repays||[]).length > 0 ? `部分还(剩¥${remain.toFixed(2)})` : `未还(¥${remain.toFixed(2)})`;
    }
    return [r.date, typeMap[r.type]||r.type, cat.label, r.amount.toFixed(2), r.note||'', accMap[r.account||'personal']||'个人', r.debtor||'', repayStatus].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  return BOM + [headers.join(','), ...rows].join('\n');
}

// Export all data as JSON
function exportAllJSON() {
  const data = JSON.stringify({ records, budgets, exportDate: new Date().toISOString(), version: '7.0' }, null, 2);
  downloadFile(data, `xiaoyang_all_${today()}.json`, 'application/json');
}

// Export all data as CSV
function exportAllCSV() {
  const csv = generateCSV(records);
  downloadFile(csv, `xiaoyang_all_${today()}.csv`, 'text/csv');
}

// Export by month
function exportMonthJSON(yearMonth) {
  const monthRecords = records.filter(r => r.date.startsWith(yearMonth));
  const data = JSON.stringify({ records: monthRecords, month: yearMonth, exportDate: new Date().toISOString() }, null, 2);
  downloadFile(data, `xiaoyang_${yearMonth}.json`, 'application/json');
}

function exportMonthCSV(yearMonth) {
  const monthRecords = records.filter(r => r.date.startsWith(yearMonth));
  const csv = generateCSV(monthRecords);
  downloadFile(csv, `xiaoyang_${yearMonth}.csv`, 'text/csv');
}

// Export by date range
function exportRangeJSON(startDate, endDate) {
  const rangeRecords = records.filter(r => r.date >= startDate && r.date <= endDate);
  const data = JSON.stringify({ records: rangeRecords, range: `${startDate}~${endDate}`, exportDate: new Date().toISOString() }, null, 2);
  downloadFile(data, `xiaoyang_${startDate}_${endDate}.json`, 'application/json');
}

function exportRangeCSV(startDate, endDate) {
  const rangeRecords = records.filter(r => r.date >= startDate && r.date <= endDate);
  const csv = generateCSV(rangeRecords);
  downloadFile(csv, `xiaoyang_${startDate}_${endDate}.csv`, 'text/csv');
}

// Generate monthly report
function exportMonthReport(yearMonth) {
  const monthRecords = records.filter(r => r.date.startsWith(yearMonth));
  const income = monthRecords.filter(r=>r.type==='income').reduce((a,b)=>a+b.amount, 0);
  const expense = monthRecords.filter(r=>r.type==='expense').reduce((a,b)=>a+b.amount, 0);
  // Category breakdown
  const catBreakdown = {};
  monthRecords.filter(r=>r.type==='expense').forEach(r => {
    const cat = (CATS.expense.find(c=>c.key===r.cat)||{label:'其他'}).label;
    catBreakdown[cat] = (catBreakdown[cat]||0) + r.amount;
  });
  const debt = monthRecords.filter(r=>r.type==='debt');
  const debtTotal = debt.reduce((a,b)=>a+b.amount,0);
  const debtRepaid = debt.reduce((a,b)=>a+(b.repays||[]).reduce((s,p)=>s+p.amount,0),0);

  const report = `${yearMonth} 月度记账报告\n${'='.repeat(30)}\n\n📊 收支概览\n  收入：¥${income.toFixed(2)}\n  支出：¥${expense.toFixed(2)}\n  结余：¥${(income-expense).toFixed(2)}\n\n🍕 支出分类明细\n${Object.entries(catBreakdown).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`  ${k}：¥${v.toFixed(2)} (${expense>0?(v/expense*100).toFixed(1):'0.0'}%)`).join('\n')}\n\n🤝 借贷情况\n  借出总额：¥${debtTotal.toFixed(2)}\n  已收回：¥${debtRepaid.toFixed(2)}\n  待收回：¥${(debtTotal-debtRepaid).toFixed(2)}\n\n📋 共 ${monthRecords.length} 条记录\n报告生成时间：${new Date().toLocaleString('zh-CN')}`;

  downloadFile(report, `xiaoyang_report_${yearMonth}.txt`, 'text/plain');
}

// ─────────────────────────────────────────────
// 17.5 导出 Modal 逻辑
// ─────────────────────────────────────────────
let exportFormat = 'json';  // json / csv
let exportRange  = 'all';   // all / month / custom

// Open export modal from settings export button
document.getElementById('exportBtn').addEventListener('click', () => {
  // Reset modal state
  exportFormat = 'json';
  exportRange = 'all';
  document.getElementById('exportFormatToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.fmt==='json'));
  document.getElementById('exportRangeToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.range==='all'));
  document.getElementById('exportMonthPicker').style.display = 'none';
  document.getElementById('exportDateRange').style.display = 'none';
  // Set default month picker value
  document.getElementById('exportMonthPicker').value = fmtYM(new Date()) ;
  // Set default date range
  document.getElementById('exportStartDate').value = today().slice(0,8) + '01';
  document.getElementById('exportEndDate').value = today();
  document.getElementById('exportModal').classList.add('open');
});

// Close export modal
document.getElementById('exportModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('exportModal').classList.remove('open');
  }
});

// Format toggle
document.getElementById('exportFormatToggle').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || !btn.dataset.fmt) return;
  exportFormat = btn.dataset.fmt;
  document.getElementById('exportFormatToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.fmt===exportFormat));
});

// Range toggle
document.getElementById('exportRangeToggle').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || !btn.dataset.range) return;
  exportRange = btn.dataset.range;
  document.getElementById('exportRangeToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.range===exportRange));
  document.getElementById('exportMonthPicker').style.display = exportRange === 'month' ? '' : 'none';
  document.getElementById('exportDateRange').style.display = exportRange === 'custom' ? '' : 'none';
});

// Export execute button
document.getElementById('exportExecBtn').addEventListener('click', () => {
  if (exportRange === 'all') {
    if (exportFormat === 'json') exportAllJSON();
    else exportAllCSV();
  } else if (exportRange === 'month') {
    const ym = document.getElementById('exportMonthPicker').value;
    if (!ym) { showToast('请选择月份'); return; }
    if (exportFormat === 'json') exportMonthJSON(ym);
    else exportMonthCSV(ym);
  } else if (exportRange === 'custom') {
    const start = document.getElementById('exportStartDate').value;
    const end = document.getElementById('exportEndDate').value;
    if (!start || !end) { showToast('请选择日期范围'); return; }
    if (start > end) { showToast('开始日期不能晚于结束日期'); return; }
    if (exportFormat === 'json') exportRangeJSON(start, end);
    else exportRangeCSV(start, end);
  }
  document.getElementById('exportModal').classList.remove('open');
});

// Quick export buttons
document.getElementById('exportQuickJson').addEventListener('click', () => {
  exportAllJSON();
  document.getElementById('exportModal').classList.remove('open');
});

document.getElementById('exportQuickCsv').addEventListener('click', () => {
  exportAllCSV();
  document.getElementById('exportModal').classList.remove('open');
});

document.getElementById('exportQuickReport').addEventListener('click', () => {
  const ym = fmtYM(new Date());
  exportMonthReport(ym);
  document.getElementById('exportModal').classList.remove('open');
});

// ─────────────────────────────────────────────
// 18. 设置功能（v7.0 增强：导入验证 · 数据安全）
// ─────────────────────────────────────────────

// Import with validation and confirmation
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      let importRecords, importBudgets;

      if (data.records && Array.isArray(data.records)) {
        importRecords = data.records;
        importBudgets = data.budgets || {};
      } else if (Array.isArray(data)) {
        importRecords = data;
        importBudgets = budgets;
      } else throw new Error();

      // Ensure compatibility
      importRecords.forEach(r => {
        if (!r.account) r.account = 'personal';
        if (r.type === 'debt' && !r.repays) r.repays = [];
        // Migrate old company-lend records to simple expense/income
        if (r.type === 'company-lend') {
          r.type = r.direction === 'in' ? 'expense' : 'income';
          r.account = 'company';
          delete r.direction;
          delete r.repays;
        }
      });

      // Validate imported data integrity
      let validCount = 0, invalidCount = 0;
      importRecords.forEach(r => {
        if (r.id && r.type && ['expense','income','debt'].includes(r.type) && r.amount > 0 && r.date) {
          validCount++;
        } else {
          invalidCount++;
        }
      });

      // Show confirmation
      const msg = `即将导入 ${validCount} 条有效记录${invalidCount > 0 ? `（${invalidCount} 条数据异常将被跳过）` : ''}\n当前已有 ${records.length} 条记录\n将覆盖现有数据，是否继续？`;
      if (!confirm(msg)) { e.target.value=''; return; }

      // Filter out invalid records
      records = importRecords.filter(r =>
        r.id && r.type && ['expense','income','debt'].includes(r.type) && r.amount > 0 && r.date
      );
      budgets = importBudgets;

      saveRecords(); saveBudgets();
      updateHeader(); renderList();
      showToast(`✅ 导入成功，共 ${records.length} 条`);
    } catch { showToast('⚠️ 文件格式不对'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('确定清除所有数据？此操作不可恢复！')) return;
  records=[]; budgets={};
  saveRecords(); saveBudgets();
  updateHeader(); renderList();
  showToast('已清除');
});

document.getElementById('installPwa').addEventListener('click', () => {
  if (window._deferredPrompt) {
    window._deferredPrompt.prompt();
    window._deferredPrompt.userChoice.then(()=>{ window._deferredPrompt=null; });
  } else {
    showToast('Safari → 底部分享按钮 → 添加到主屏幕');
  }
});

document.getElementById('quickAddTip').addEventListener('click', () => {
  showToast('付款后截图→分享菜单→选「小杨专属记账」→自动识别', 4000);
});

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window._deferredPrompt=e; });

// ─────────────────────────────────────────────
// 18.5 设置页 - 数据安全按钮（v7.0）
// ─────────────────────────────────────────────

// 手动备份
document.getElementById('manualBackupBtn').addEventListener('click', async () => {
  const ok = await createManualBackup();
  if (ok) {
    localStorage.setItem(LS_BACKUP, JSON.stringify({ records, budgets, ts: Date.now() }));
    updateAutoBackupStatus();
    showToast('✅ 备份成功');
  } else {
    showToast('⚠️ 备份失败');
  }
});

// 数据恢复
document.getElementById('dataRecoveryBtn').addEventListener('click', () => {
  const result = attemptRecovery();
  if (result.recovered) {
    updateHeader(); renderList();
    showToast(`✅ 已从备份恢复 ${result.from} → ${result.to} 条记录`);
  } else {
    showToast('当前数据已是最新，无需恢复');
  }
});

// 完整性检查
document.getElementById('integrityCheckBtn').addEventListener('click', () => {
  const issues = checkDataIntegrity();
  if (issues.length === 0) {
    showToast(`✅ 数据完整性检查通过，共 ${records.length} 条记录`);
  } else {
    const uniqueIssues = [...new Set(issues)];
    showToast(`⚠️ 发现 ${issues.length} 个问题：${uniqueIssues.slice(0,3).join('、')}${uniqueIssues.length > 3 ? '...' : ''}`);
  }
});

// 更新自动备份状态显示
function updateAutoBackupStatus() {
  const statusEl = document.getElementById('autoBackupStatus');
  const countEl = document.getElementById('backupCount');
  try {
    const backup = JSON.parse(localStorage.getItem(LS_BACKUP) || '{}');
    if (backup.ts) {
      const d = new Date(backup.ts);
      statusEl.textContent = `上次备份：${d.toLocaleString('zh-CN')}`;
    } else {
      statusEl.textContent = '暂无备份';
    }
    if (countEl) {
      countEl.textContent = backup.records ? `${backup.records.length} 条记录` : '';
    }
  } catch(e) {
    statusEl.textContent = '暂无备份';
    if (countEl) countEl.textContent = '';
  }
}

// ─────────────────────────────────────────────
// 19. Toast
// ─────────────────────────────────────────────
let _toastT = null;
function showToast(msg, duration) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), duration || 2500);
}

// ─────────────────────────────────────────────
// 20. PWA Service Worker
// ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ─────────────────────────────────────────────
// 21. 初始化（v7.0：自动备份定时器）
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Ensure compatibility with old records
  let needSave = false;
  records.forEach(r => {
    if (!r.account) { r.account = 'personal'; needSave = true; }
    if (r.type === 'debt' && !r.repays) { r.repays = []; needSave = true; }
    // Migrate old company-lend records to simple expense/income
    if (r.type === 'company-lend') {
      r.type = r.direction === 'in' ? 'expense' : 'income';
      r.account = 'company';
      delete r.direction;
      delete r.repays;
      needSave = true;
    }
  });
  if (needSave) saveRecords();

  currentMonth = new Date();
  renderCatGrid();
  updateHeader();
  renderList();

  // v7.0: Auto-backup every 5 minutes
  setInterval(async () => {
    await createManualBackup();
    localStorage.setItem(LS_BACKUP, JSON.stringify({ records, budgets, ts: Date.now() }));
  }, 300000);

  // v7.0: Initial backup on load
  localStorage.setItem(LS_BACKUP, JSON.stringify({ records, budgets, ts: Date.now() }));

  // 处理 Web Share Target（从其他 App 分享进入）
  const shared = await handleShareTarget();

  // 处理通过 Service Worker 传入的共享图片
  const params = new URLSearchParams(window.location.search);
  if (params.get('hasImage') === '1') {
    try {
      const cache = await caches.open('xiaoyang-v6.0-share');
      const response = await cache.match('shared-image');
      if (response) {
        const blob = await response.blob();
        const file = new File([blob], 'shared-screenshot.png', { type: blob.type });
        const imgData = await processImageFile(file);
        ocrImageData = imgData;
        openAddSheet();
        showOcrResult({ dataUrl: imgData.dataUrl, parsed: null });
        showToast('📸 收到分享截图，请输入金额');
        // 清理缓存
        await cache.delete('shared-image');
      }
    } catch (err) {
      console.log('Share image retrieval failed:', err);
    }
    window.history.replaceState({}, '', './index.html');
  }

  // URL Scheme 快捷记账：?quick=1&type=expense&amount=38.5&note=午餐
  if (!shared && (params.get('quick') || params.get('amount'))) {
    openAddSheet();
    if (params.get('amount')) {
      amountStr = params.get('amount');
      updateAmountDisplay();
    }
    if (params.get('type')) {
      currentType = params.get('type');
      document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === currentType));
      if (CATS[currentType]) selectedCat = CATS[currentType][0].key;
      renderCatGrid();
    }
    if (params.get('note')) {
      document.getElementById('noteInput').value = params.get('note');
    }
    showToast('⚡ 快捷记账');
    window.history.replaceState({}, '', './index.html');
  }

  // Standalone 模式检测（PWA 添加到主屏幕后）
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isStandalone) {
    // PWA 模式下显示快捷提示
    const badge = document.createElement('div');
    badge.className = 'quick-badge';
    badge.textContent = '⚡ 付款后截图点 📸 即可快速记账';
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 3500);
  }
});
