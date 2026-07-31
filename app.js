// 模組化狀態管理 (AppState)
const state = {
  apiUrl: localStorage.getItem('GAS_API_URL') || '',
  token: localStorage.getItem('MEMBER_TOKEN') || null,
  theme: localStorage.getItem('THEME') || 'dark',
  currentUser: null,
  currentGroup: null,
  appData: null
};

let calcExpr = '0';
let activeCalcTargetId = 'amountDisplay';
let currentBase64Image = "";
let detailBase64Image = "";
let activeSettleData = null;
let currentEditingExpenseId = null;

// 安全 escapeHTML 函式 (防 XSS)
function escapeHTML(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// 安全計算機 eval 代替方案 (safeEval)
function safeEval(expr) {
  if (!/^[0-9+\-*/. ]+$/.test(expr)) return 0;
  try {
	return Function(`'use strict'; return (${expr})`)();
  } catch (e) {
	return 0;
  }
}

// 離線狀態監聽 (Offline Listener)
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function updateOnlineStatus() {
  const notice = document.getElementById('offlineNotice');
  if (notice) {
	if (!navigator.onLine) {
	  notice.classList.remove('hidden');
	} else {
	  notice.classList.add('hidden');
	}
  }
}

// 下拉刷新 (Pull-To-Refresh) 全局變數
let touchStartY = 0;
let touchMoveY = 0;
let isPulling = false;
const PULL_THRESHOLD = 80;

// 控制 MENU 開關
function toggleDashMenu() {
  const menu = document.getElementById('dashMenuDropdown');
  if (menu) {
	menu.classList.toggle('hidden');
	menu.classList.toggle('flex');
  }
}

// 點擊選單外部自動關閉 MENU
document.addEventListener('click', (e) => {
  const menu = document.getElementById('dashMenuDropdown');
  const btn = document.getElementById('btnDashMenu');
  if (menu && btn && !menu.classList.contains('hidden')) {
	if (!menu.contains(e.target) && !btn.contains(e.target)) {
	  menu.classList.add('hidden');
	  menu.classList.remove('flex');
	}
  }
});

// 註冊 Service Worker (PWA 核心功能)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
	navigator.serviceWorker.register('./sw.js')
	  .then(reg => console.log('Service Worker 註冊成功！範疇：', reg.scope))
	  .catch(err => console.error('Service Worker 註冊失敗：', err));
  });
}

// 輸出戰報功能 (Export Report to CSV)
function exportReport() {
  if (!state.appData) return alert('尚未加載戰報數據！');

  const groupName = document.getElementById('currentGroupName').innerText || '車隊';
  let csvContent = '\uFEFF'; // UTF-8 BOM 避免 Excel 亂碼

  // 1. 車隊概況
  csvContent += `=== NFS 車隊戰報：${groupName} ===\n`;
  csvContent += `總支出（不含雜項/還款）,$${state.appData.totalGroupExpense || 0}\n\n`;

  // 2. 個人戰績 (應收/應付結算)
  csvContent += `=== 個人戰績結算 ===\n`;
  csvContent += `成員,個人結算金額,狀態\n`;
  if (state.appData.balances) {
	for (const [name, val] of Object.entries(state.appData.balances)) {
	  const rounded = Math.round(val * 10) / 10;
	  let status = '已結清';
	  if (rounded > 0) status = `應收 $${rounded}`;
	  else if (rounded < 0) status = `應付 $${Math.abs(rounded)}`;
	  csvContent += `"${name}","${rounded}","${status}"\n`;
	}
  }
  csvContent += `\n`;

  // 3. 最佳還款路線
  csvContent += `=== 最佳還款路線 ===\n`;
  csvContent += `付款人,收款人,還款金額\n`;
  if (state.appData.settlements && state.appData.settlements.length > 0) {
	state.appData.settlements.forEach(s => {
	  csvContent += `"${s.from}","${s.to}","$${s.amount}"\n`;
	});
  } else {
	csvContent += `無欠款,無欠款,0\n`;
  }
  csvContent += `\n`;

  // 4. 明細紀錄 (Race Logs)
  csvContent += `=== 明細紀錄 (Race Logs) ===\n`;
  csvContent += `日期,類別,項目說明,買單車手,總金額,分攤車手,狀態,備註\n`;

  if (state.appData.expenses && state.appData.expenses.length > 0) {
	state.appData.expenses.forEach(e => {
	  const isPayment = e.type === 'PAYMENT';
	  const category = e.category || (isPayment ? '💵 還款' : '其他');
	  const desc = (e.desc || '').replace(/"/g, '""');
	  const payer = e.payer || '';
	  const amount = e.amount || 0;
	  const participants = (e.participants || []).join('; ');
	  const status = isPayment ? '已全部付款' : getExpenseStatus(e);
	  const remark = (e.remark || '').replace(/"/g, '""');
	  const date = e.date || '';

	  csvContent += `"${date}","${category}","${desc}","${payer}","${amount}","${participants}","${status}","${remark}"\n`;
	});
  }

  // 下載 Blob 檔案
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  
  const today = new Date().toISOString().split('T')[0];
  link.setAttribute('download', `${groupName}_NFS戰報_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 初始化下拉更新監聽器
function initPullToRefresh() {
  const ptrContainer = document.getElementById('ptrContainer');
  const ptrIcon = document.getElementById('ptrIcon');
  const ptrText = document.getElementById('ptrText');

  window.addEventListener('touchstart', (e) => {
	const dashView = document.getElementById('groupDashboardView');
	if (dashView.classList.contains('hidden')) return;
	if (window.scrollY > 0) return;

	touchStartY = e.touches[0].clientY;
	isPulling = true;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
	if (!isPulling) return;
	touchMoveY = e.touches[0].clientY;
	const pullDistance = touchMoveY - touchStartY;

	if (pullDistance > 0 && window.scrollY === 0) {
	  ptrContainer.classList.add('pulling');
	  ptrContainer.style.opacity = '1';
	  
	  const height = Math.min(pullDistance * 0.5, PULL_THRESHOLD + 20);
	  ptrContainer.style.height = `${height}px`;

	  if (height >= PULL_THRESHOLD) {
		ptrIcon.innerText = '🏎️💨';
		ptrText.innerText = '鬆開以更新賽道數據！';
	  } else {
		ptrIcon.innerText = '⬇️';
		ptrText.innerText = '下拉更新數據...';
	  }
	}
  }, { passive: true });

  window.addEventListener('touchend', () => {
	if (!isPulling) return;
	isPulling = false;
	ptrContainer.classList.remove('pulling');

	const pullDistance = touchMoveY - touchStartY;
	if (pullDistance * 0.5 >= PULL_THRESHOLD && window.scrollY === 0) {
	  ptrIcon.innerText = '⚡';
	  ptrText.innerText = '正在加載最新戰報...';
	  ptrContainer.style.height = '60px';

	  if (typeof loadGroupData === 'function' && state.currentGroup) {
		loadGroupData();
	  } else if (typeof loadMyGroups === 'function') {
		loadMyGroups();
	  }
	  
	  setTimeout(() => {
		resetPtr();
	  }, 1000);
	} else {
	  resetPtr();
	}
	
	touchStartY = 0;
	touchMoveY = 0;
  });

  function resetPtr() {
	ptrContainer.style.height = '0px';
	ptrContainer.style.opacity = '0';
  }
}

// 判斷訂單 STATUS
function getExpenseStatus(exp) {
  if (!exp) return '未完成分帳';
  
  const totalAmount = parseFloat(exp.amount) || 0;
  const shares = exp.shares || {};
  const shareValues = Object.values(shares).map(v => parseFloat(v) || 0);
  const totalShares = shareValues.reduce((a, b) => a + b, 0);

  if (totalAmount === 0 || totalShares < totalAmount || shareValues.some(v => v === 0)) {
	return '未完成分帳';
  }

  return exp.status;
}

window.onload = function() {
  updateOnlineStatus();
  applyTheme(state.theme);
  initPullToRefresh();

  if (!state.apiUrl && typeof google === 'undefined') {
	openApiModal();
  } else if (state.token) {
	// 使用 Web Storage 實現 Optimistic UI / Cache 載入，並預設先顯示 GroupSelection
	const cachedAppData = localStorage.getItem(`NFS_CACHE_${state.token}`);
	if (cachedAppData) {
	  try {
		const cache = JSON.parse(cachedAppData);
		state.currentUser = cache.currentUser;
		if (cache.appData) {
		  state.appData = cache.appData;
		}
	  } catch(e) {}
	}
	// 強制先呈現 Group Selection, 避免多視圖疊加及 F5 重新整理白屏/錯誤
	document.getElementById('loginView').classList.add('hidden');
	document.getElementById('groupDashboardView').classList.add('hidden');
	document.getElementById('fabAddExpense').classList.add('hidden');
	document.getElementById('groupSelectionView').classList.remove('hidden');

	verifyAndLoad(state.token);
  }
};

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('THEME', state.theme);
  applyTheme(state.theme);
}

function applyTheme(theme) {
  if (theme === 'light') {
	document.body.classList.remove('dark');
	document.body.classList.add('light');
	document.documentElement.classList.remove('dark');
	updateThemeIcons('☀️ 【日】Sol');
  } else {
	document.body.classList.remove('light');
	document.body.classList.add('dark');
	document.documentElement.classList.add('dark');
	updateThemeIcons('🌙 【夜】Eclipse');
  }
}

function updateThemeIcons(text) {
  const el1 = document.getElementById('themeIconLogin');
  const el2 = document.getElementById('themeIconGroup');
  const el3 = document.getElementById('themeIconDash');
  
  if(el1) el1.innerText = text;
  if(el2) el2.innerText = text;
  if(el3) el3.innerText = state.theme === 'light' ? '☀️' : '🌙';
}

function callGas(action, payload = {}) {
  if (!navigator.onLine) {
	return Promise.reject(new Error('目前處於離線狀態，無法同步賽道數據。'));
  }
  return new Promise((resolve, reject) => {
	if (typeof google !== 'undefined' && google.script && google.script.run) {
	  google.script.run
		.withSuccessHandler(resolve)
		.withFailureHandler(reject)[action](...Object.values(payload));
	} else {
	  fetch(state.apiUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'text/plain;charset=utf-8' },
		body: JSON.stringify({ action, ...payload })
	  })
	  .then(res => res.json())
	  .then(res => {
		if (res && res.error) reject(new Error(res.error));
		else resolve(res);
	  })
	  .catch(reject);
	}
  });
}

function openApiModal() {
  document.getElementById('apiUrlInput').value = state.apiUrl;
  document.getElementById('apiModal').classList.remove('hidden');
}

function closeApiModal() {
  document.getElementById('apiModal').classList.add('hidden');
}

function saveApiUrl() {
  const url = document.getElementById('apiUrlInput').value.trim();
  if (!url.startsWith('https://script.google.com')) {
	return alert('請輸入有效的 Google Apps Script API 網址！');
  }
  state.apiUrl = url;
  localStorage.setItem('GAS_API_URL', url);
  closeApiModal();
  if (state.token) verifyAndLoad(state.token);
}

function showLoading() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

function handleLogin() {
  if (!state.apiUrl && typeof google === 'undefined') return openApiModal();
  const token = document.getElementById('tokenInput').value.trim().toUpperCase();
  if (token.length !== 20) return showError('Drive License 必須為 20 位字元！');
  showLoading();
  verifyAndLoad(token);
}

function showError(msg) {
  const errElem = document.getElementById('loginError');
  if (errElem) {
	errElem.innerText = msg;
	errElem.classList.remove('hidden');
  }
}

function verifyAndLoad(token) {
  callGas('loginWithToken', { token })
	.then((res) => {
	  hideLoading();
	  if (res.success) {
		state.token = token;
		state.currentUser = res.member;
		localStorage.setItem('MEMBER_TOKEN', token);
		
		document.getElementById('loginView').classList.add('hidden');
		if (!state.currentGroup) {
		  document.getElementById('groupDashboardView').classList.add('hidden');
		  document.getElementById('fabAddExpense').classList.add('hidden');
		  document.getElementById('groupSelectionView').classList.remove('hidden');
		}
		
		const adminBadge = state.currentUser.isAdmin ? ' [👑 ADMIN]' : '';
		const memberName = escapeHTML(state.currentUser.memberName || state.currentUser.name || 'UNKNOWN');
		const memberId = escapeHTML(state.currentUser.memberId || state.currentUser.id || token);
		
		document.getElementById('welcomeUser').innerHTML = `
		  <div class="flex flex-col items-center leading-tight">
			<span class="font-black text-xs md:text-sm">🏎️ ${memberName}${adminBadge}</span>
			<div class="flex items-center space-x-1 mt-0.5">
			  <span class="text-[10px] md:text-xs font-mono opacity-80">ID: ${memberId}</span>
			  <button onclick="copyMyMemberId('${memberId}', this)" class="text-[10px] md:text-xs hover:scale-125 transition-transform" title="複製 Member ID">📋</button>
			</div>
		  </div>
		`;
		
		loadMyGroups();
	  } else {
		showError(res.message);
		localStorage.removeItem('MEMBER_TOKEN');
		document.getElementById('groupSelectionView').classList.add('hidden');
		document.getElementById('groupDashboardView').classList.add('hidden');
		document.getElementById('loginView').classList.remove('hidden');
	  }
	})
	.catch((err) => {
	  hideLoading();
	  if (state.appData) return; // 已由快取渲染
	  showError('連線失敗，請檢查 API 網址！');
	});
}

function handleLogout() {
  localStorage.removeItem('MEMBER_TOKEN');
  state.token = null;
  state.currentUser = null;
  state.appData = null;
  state.currentGroup = null;
  document.getElementById('groupSelectionView').classList.add('hidden');
  document.getElementById('groupDashboardView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
}

function copyMyMemberId(id, btn) {
  navigator.clipboard.writeText(id).then(() => {
	const originalText = btn.innerText;
	btn.innerText = '✅';
	setTimeout(() => { btn.innerText = originalText; }, 1500);
  });
}

function loadMyGroups() {
  showLoading();
  callGas('getGroupsByToken', { token: state.token })
	.then((groups) => {
	  hideLoading();
	  renderGroupList(groups || []);
	})
	.catch((err) => {
	  hideLoading();
	  alert('載入車隊失敗：' + err.message);
	});
}

function renderGroupList(groups) {
  const container = document.getElementById('groupList');
  if (!groups || groups.length === 0) {
	container.innerHTML = '<p class="text-xs md:text-sm font-bold text-slate-500 py-4 text-center">你目前尚未加入任何車隊群組。</p>';
	return;
  }
  container.innerHTML = groups.map(g => `
	<div onclick="selectGroup('${escapeHTML(g.id)}', '${escapeHTML(g.name)}')" 
		 class="flex justify-between items-center p-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-2 border-black rounded-2xl cursor-pointer shadow-[3px_3px_0px_#facc15] active:translate-y-1">
	  <span class="font-nfs font-black text-slate-900 dark:text-yellow-400 text-lg md:text-xl">🏎️ ${escapeHTML(g.name)}</span>
	  <span class="text-xs md:text-sm font-nfs text-base md:text-lg font-black bg-red-600 text-white px-3 py-1 rounded-lg border border-black">DRIVE →</span>
	</div>
  `).join('');
}

function selectGroup(id, name) {
  state.currentGroup = id;
  document.getElementById('currentGroupName').innerText = name;
  document.getElementById('groupSelectionView').classList.add('hidden');
  document.getElementById('groupDashboardView').classList.remove('hidden');
  document.getElementById('fabAddExpense').classList.remove('hidden');
  loadGroupData();
}

function backToGroupSelection() {
  state.currentGroup = null;
  document.getElementById('groupDashboardView').classList.add('hidden');
  document.getElementById('fabAddExpense').classList.add('hidden');
  document.getElementById('groupSelectionView').classList.remove('hidden');
  loadMyGroups();
}

function loadGroupData() {
  if (!state.currentGroup) return backToGroupSelection();
  showLoading();
  callGas('getGroupData', { token: state.token, groupId: state.currentGroup })
	.then((data) => {
	  hideLoading();
	  renderApp(data);
	  // 快取資料加速下一次載入
	  localStorage.setItem(`NFS_CACHE_${state.token}`, JSON.stringify({
		currentUser: state.currentUser,
		appData: data
	  }));
	})
	.catch((err) => {
	  hideLoading();
	  alert('取得群組資料失敗：' + err.message);
	});
}

function renderApp(data) {
  if (!data) return;
  state.appData = data;
  
  if (data.expenses) {
	data.totalGroupExpense = data.expenses.reduce((sum, e) => {
	  if (e.type !== 'PAYMENT' && (!e.category || (!e.category.includes('雜項') && !e.category.includes('還款')))) {
		return sum + (parseFloat(e.amount) || 0);
	  }
	  return sum;
	}, 0);
  } else {
	data.totalGroupExpense = 0;
	data.expenses = [];
  }

  if (!data.balances) data.balances = {};
  if (!data.settlements) data.settlements = [];
  if (!data.members) data.members = [];

  if (state.currentUser && state.currentUser.isAdmin) {
	const crewBtn = document.getElementById('btnManageCrew');
	if (crewBtn) {
	  crewBtn.classList.remove('hidden');
	  crewBtn.classList.add('flex');
	}
  } else {
	const crewBtn = document.getElementById('btnManageCrew');
	if (crewBtn) {
	  crewBtn.classList.add('hidden');
	  crewBtn.classList.remove('flex');
	}
  }

  renderStats(data);
  renderBalances(data.balances);
  renderSettlements(data.settlements);
  renderFormOptions(data.members);
  renderFeed(data.expenses);
}

function renderStats(data) {
  document.getElementById('statTotalExpense').innerText = `$${(data.totalGroupExpense || 0).toLocaleString()}`;
  const myName = state.currentUser ? state.currentUser.memberName : '';
  const myBal = (data.balances && myName) ? (data.balances[myName] || 0) : 0;
  const rounded = Math.round(myBal * 10) / 10;
  const elem = document.getElementById('statMyBalance');

  if (rounded > 0) {
	elem.innerText = `應收 $${rounded}`;
	elem.className = 'text-sm md:text-base font-black text-green-500 mt-1';
  } else if (rounded < 0) {
	elem.innerText = `應付 $${Math.abs(rounded)}`;
	elem.className = 'text-sm md:text-base font-black text-red-500 mt-1';
  } else {
	elem.innerText = `READY / 已結清 ⚡`;
	elem.className = 'text-sm md:text-base font-black text-yellow-500 dark:text-yellow-400 mt-1';
  }
}

function openExpenseDrawer() {
  const overlay = document.getElementById('expenseDrawerOverlay');
  const drawer = document.getElementById('expenseDrawer');

  document.body.style.overflow = 'hidden';
  overlay.classList.remove('opacity-0', 'pointer-events-none');
  overlay.classList.add('pointer-events-auto');
  drawer.classList.remove('translate-y-full', 'sm:translate-x-full');
  drawer.classList.add('translate-y-0', 'sm:translate-x-0');
}

function closeExpenseDrawer() {
  const overlay = document.getElementById('expenseDrawerOverlay');
  const drawer = document.getElementById('expenseDrawer');

  document.body.style.overflow = '';
  overlay.classList.add('opacity-0', 'pointer-events-none');
  overlay.classList.remove('pointer-events-auto');
  drawer.classList.remove('translate-y-0', 'sm:translate-x-0');
  drawer.classList.add('translate-y-full', 'sm:translate-x-full');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
	closeExpenseDrawer();
	closeExpenseDetailModal();
	closeDriverRegisterModal();
	closeManageCrewModal();
	closeCreateGroupModal();
	closeApiModal();
	closeMemberModal();
	closeTokenModal();
	closeSettleModal();
	closeCalcModal();
  }
});

function openManageCrewModal() {
  if (!state.appData || !state.appData.members) return;
  const container = document.getElementById('crewMembersList');
  container.innerHTML = '';

  callGas('getAllSystemMembers').then(allMembers => {
	state.appData.members.forEach(member => {
	  const sysMember = (allMembers || []).find(m => m.name === member);
	  const memberId = sysMember ? sysMember.id : null;
	  const safeMemberName = escapeHTML(member);

	  container.innerHTML += `
		<div class="flex justify-between items-center p-2.5 bg-slate-100 dark:bg-slate-800 border-2 border-black rounded-xl shadow-[2px_2px_0px_#000]">
		  <span class="font-black text-xs md:text-sm text-slate-900 dark:text-white">🏎️ ${safeMemberName}</span>
		  ${memberId ? `
			<button onclick="handleRemoveMember('${escapeHTML(memberId)}', '${safeMemberName}', this)" class="nfs-btn-red text-[10px] md:text-xs font-black px-2 py-1 rounded-lg">
			  🗑️ 踢出
			</button>
		  ` : ''}
		</div>
	  `;
	});
  });

  document.getElementById('manageCrewModal').classList.remove('hidden');
}

function closeManageCrewModal() { document.getElementById('manageCrewModal').classList.add('hidden'); }

function handleRemoveMember(memberId, memberName, btnElem) {
  if (!confirm(`確定要將車手【${memberName}】移除出此車隊嗎？`)) return;

  if (btnElem) btnElem.disabled = true;
  showLoading();
  callGas('removeMemberFromGroup', {
	adminToken: state.token,
	groupId: state.currentGroup,
	targetMemberId: memberId
  })
  .then(data => {
	hideLoading();
	if (btnElem) btnElem.disabled = false;
	renderApp(data);
	openManageCrewModal();
  })
  .catch(err => {
	hideLoading();
	if (btnElem) btnElem.disabled = false;
	alert('移除成員失敗：' + err.message);
  });
}

function openCreateGroupModal() { 
  document.getElementById('createGroupModal').classList.remove('hidden');
  document.getElementById('newGroupName').value = '';
  document.getElementById('memberIdsInput').value = '';
}

function closeCreateGroupModal() { document.getElementById('createGroupModal').classList.add('hidden'); }
function openMemberModal() { document.getElementById('memberModal').classList.remove('hidden'); }
function closeMemberModal() { document.getElementById('memberModal').classList.add('hidden'); }
function closeTokenModal() {
  document.getElementById('tokenModal').classList.add('hidden');
  if (state.currentGroup) {
	loadGroupData();
  }
}

function openDriverRegisterModal() {
  if (!state.apiUrl && typeof google === 'undefined') return openApiModal();
  document.getElementById('registerDriverName').value = '';
  document.getElementById('driverRegisterModal').classList.remove('hidden');
}

function closeDriverRegisterModal() {
  document.getElementById('driverRegisterModal').classList.add('hidden');
}

function submitDriverRegister() {
  const name = document.getElementById('registerDriverName').value.trim();
  if (!name) return alert('請輸入車手代號/暱稱！');

  closeDriverRegisterModal();
  showLoading();
  callGas('registerDriver', { name: name })
	.then((res) => {
	  hideLoading();
	  if (res && res.token) {
		document.getElementById('newTokenDisplay').innerText = res.token;
		document.getElementById('tokenModal').classList.remove('hidden');
		document.getElementById('tokenInput').value = res.token;
	  } else {
		alert(res.message || '註冊失敗，請重試！');
	  }
	})
	.catch((err) => {
	  hideLoading();
	  alert('註冊失敗：' + err.message);
	});
}

function copyTokenToClipboard() {
  const tokenText = document.getElementById('newTokenDisplay').innerText;
  navigator.clipboard.writeText(tokenText).then(() => {
	const btn = document.getElementById('btnCopyToken');
	btn.innerText = '✅ Driver License COPIED!';
	setTimeout(() => btn.innerText = '📋 複製 Driver License', 2000);
  });
}

function submitNewGroup() {
  const name = document.getElementById('newGroupName').value.trim();
  if (!name) return alert('請輸入車隊名稱');

  const rawIds = document.getElementById('memberIdsInput').value;
  const memberIds = rawIds
	.split(/[\n,\s]+/)
	.map(id => id.trim().toUpperCase())
	.filter(id => id.length > 0);

  closeCreateGroupModal();
  showLoading();
  callGas('createGroupWithCreator', { 
	groupName: name, 
	creatorToken: state.token,
	memberIds: memberIds 
  })
	.then((groups) => {
	  hideLoading();
	  renderGroupList(groups);
	})
	.catch((err) => { hideLoading(); alert('建立車隊失敗：' + err.message); });
}

function submitNewMember() {
  const name = document.getElementById('newMemberName').value.trim();
  if (!name) return alert('請輸入車手代號');

  closeMemberModal();
  showLoading();
  callGas('addMemberToGroup', { adminToken: state.token, groupId: state.currentGroup, newMemberName: name })
	.then((res) => {
	  hideLoading();
	  document.getElementById('newTokenDisplay').innerText = res.token;
	  document.getElementById('tokenModal').classList.remove('hidden');
	  document.getElementById('newMemberName').value = '';
	})
	.catch((err) => { hideLoading(); alert('招募成員失敗：' + err.message); });
}

function openCalcModal(targetInputId) { 
  activeCalcTargetId = targetInputId || 'amountDisplay';
  const targetElem = document.getElementById(activeCalcTargetId);
  calcExpr = (targetElem && targetElem.value !== '') ? String(targetElem.value) : '0';
  updateCalcDisplay();
  document.getElementById('calcModal').classList.remove('hidden'); 
}
function closeCalcModal() { document.getElementById('calcModal').classList.add('hidden'); }
function calcNum(n) { calcExpr = (calcExpr === '0') ? n : calcExpr + n; updateCalcDisplay(); }
function calcOp(op) {
  if (['+', '-', '*', '/'].includes(calcExpr.slice(-1))) calcExpr = calcExpr.slice(0, -1);
  calcExpr += op; updateCalcDisplay();
}
function calcClear() { calcExpr = '0'; updateCalcDisplay(); }
function updateCalcDisplay() {
  document.getElementById('calcFormula').innerText = calcExpr;
  const val = safeEval(calcExpr);
  document.getElementById('calcDisplay').innerText = isNaN(val) ? '0' : Math.round(val * 100) / 100;
}
function calcConfirm() {
  const val = safeEval(calcExpr);
  const finalVal = isNaN(val) ? 0 : Math.round(val * 100) / 100;
  document.getElementById(activeCalcTargetId).value = finalVal;
  closeCalcModal();

  if (activeCalcTargetId === 'detailAmountDisplay' || activeCalcTargetId.startsWith('detail-share-input-')) {
	updateRemainingCalculation();
  }
}

function previewImage(event, imgElemId, containerElemId) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
	const img = new Image();
	img.onload = function() {
	  const canvas = document.createElement('canvas');
	  const ctx = canvas.getContext('2d');
	  const maxWidth = 800;
	  let width = img.width, height = img.height;
	  if (width > maxWidth) {
		height = Math.round((height * maxWidth) / width);
		width = maxWidth;
	  }
	  canvas.width = width; canvas.height = height;
	  ctx.drawImage(img, 0, 0, width, height);
	  
	  let base64Res = canvas.toDataURL('image/jpeg', 0.7);
	  // 限制 Base64 長度上限避免超過 GAS 請求體上限 (上限約 1.5MB)
	  if (base64Res.length > 1500000) {
		base64Res = canvas.toDataURL('image/jpeg', 0.4);
	  }

	  if (imgElemId === 'imgPreview') {
		currentBase64Image = base64Res;
	  } else {
		detailBase64Image = base64Res;
		document.getElementById('detailImgLink').href = base64Res;
	  }

	  document.getElementById(imgElemId).src = base64Res;
	  document.getElementById(containerElemId).classList.remove('hidden');
	};
	img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeImage(imgElemId, containerElemId, inputElemId) {
  if (imgElemId === 'imgPreview') currentBase64Image = "";
  else detailBase64Image = "";
  
  document.getElementById(inputElemId).value = "";
  document.getElementById(containerElemId).classList.add('hidden');
}

function splitEvenly(amountElemId, checkboxName, inputPrefix) {
  const amount = parseFloat(document.getElementById(amountElemId).value) || 0;
  const checkboxes = Array.from(document.querySelectorAll(`input[name="${checkboxName}"]:checked`));
  if (checkboxes.length === 0) return;

  const count = checkboxes.length;
  const baseShare = Math.floor((amount / count) * 10) / 10;
  let remainder = Math.round((amount - baseShare * count) * 10) / 10;

  const payerSelectId = amountElemId === 'detailAmountDisplay' ? 'detailPayer' : 'payer';
  const payerVal = document.getElementById(payerSelectId) ? document.getElementById(payerSelectId).value : '';

  document.querySelectorAll(`input[name="${checkboxName}"]`).forEach(cb => {
	const input = document.getElementById(`${inputPrefix}${cb.value}`);
	if (cb.checked) {
	  let assignedShare = baseShare;
	  // 將殘餘尾數補到買單者或第一個選中的車手
	  if (remainder > 0 && (cb.value === payerVal || (!checkboxes.some(c => c.value === payerVal) && cb === checkboxes[0]))) {
		assignedShare = Math.round((baseShare + remainder) * 10) / 10;
		remainder = 0;
	  }
	  input.value = amount > 0 ? assignedShare : "0";
	  input.disabled = false;
	} else {
	  input.value = "0";
	  input.disabled = true;
	}
  });

  if (amountElemId === 'detailAmountDisplay') {
	updateRemainingCalculation();
  }
}

function handleCheckboxChange(member, checkboxName, inputPrefix, isDetail = false) {
  const cb = document.querySelector(`input[name="${checkboxName}"][value="${member}"]`);
  const input = document.getElementById(`${inputPrefix}${member}`);
  if (cb && input) {
	if (cb.checked) {
	  input.disabled = false;
	} else {
	  input.value = "0";
	  input.disabled = true;
	}
  }

  if (isDetail) updateRemainingCalculation();
}

function handlePayerChange() {
  const currentPayer = document.getElementById('payer').value;
  if (!currentPayer) return;
  
  const cb = document.querySelector(`input[name="parts"][value="${currentPayer}"]`);
  if (cb && !cb.checked) {
	cb.checked = true;
	handleCheckboxChange(currentPayer, 'parts', 'share-input-');
  }
}

function renderFormOptions(members) {
  const payerSelect = document.getElementById('payer');
  if (!members) members = [];
  payerSelect.innerHTML = members.length ? members.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('') : '<option value="">請先招募車手</option>';
  
  if (state.currentUser && members.includes(state.currentUser.memberName)) {
	payerSelect.value = state.currentUser.memberName;
  }

  const partGroup = document.getElementById('participantsGroup');
  partGroup.innerHTML = members.length ? members.map(m => {
	const isChecked = 'checked'; 
	const safeName = escapeHTML(m);
	return `
	<div class="flex items-center justify-between border-2 border-black p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-[2px_2px_0px_#000]">
	  <label class="flex items-center space-x-2 cursor-pointer text-xs md:text-sm font-black">
		<input type="checkbox" name="parts" value="${safeName}" ${isChecked} onchange="handleCheckboxChange('${safeName}', 'parts', 'share-input-')" class="w-4 h-4 rounded text-red-600 focus:ring-0 accent-red-600">
		<span>${safeName}</span>
	  </label>
	  <div class="flex items-center space-x-1">
		<span class="text-xs md:text-sm font-bold text-yellow-500 dark:text-yellow-400">$</span>
		<div class="relative flex items-center">
		  <input type="text" readonly id="share-input-${safeName}" value="0" onclick="openCalcModal('share-input-${safeName}')" class="w-20 md:w-24 bg-white dark:bg-slate-900 text-slate-900 dark:text-yellow-400 text-xs md:text-sm font-mono font-black border border-black rounded-lg px-1.5 py-1 text-right focus:outline-none cursor-pointer">
		</div>
	  </div>
	</div>
  `;
  }).join('') : '<p class="text-xs md:text-sm font-bold text-slate-500">請先招募成員</p>';

  const btn = document.getElementById('btnToggleSelectAdd');
  if (btn) btn.innerText = '取消全選';
}

function toggleSelectAllParts(checkboxName, inputPrefix, btnId) {
  const btn = document.getElementById(btnId);
  const isSelectAll = btn.innerText === '全選';

  document.querySelectorAll(`input[name="${checkboxName}"]`).forEach(cb => {
	cb.checked = isSelectAll;
	handleCheckboxChange(cb.value, checkboxName, inputPrefix, checkboxName === 'detailParts');
  });

  if (isSelectAll) {
	btn.innerText = '取消全選';
  } else {
	btn.innerText = '全選';
  }
}

function submitExpense(e) {
  if (e) e.preventDefault();
  
  let amount = parseFloat(document.getElementById('amountDisplay').value) || 0;
  const checkedBoxes = Array.from(document.querySelectorAll('input[name="parts"]:checked'));
  if (checkedBoxes.length === 0) return alert('請至少選擇一位分攤車手！');

  const shares = {};
  let totalSharesSum = 0;

  checkedBoxes.forEach(cb => {
	const val = parseFloat(document.getElementById(`share-input-${cb.value}`).value) || 0;
	shares[cb.value] = val;
	totalSharesSum += val;
  });

  if (totalSharesSum > 0 && amount === 0) {
	amount = totalSharesSum;
  }

  const submitBtn = document.getElementById('btnSubmit');
  if (submitBtn) submitBtn.disabled = true;

  closeExpenseDrawer();
  showLoading();

  const payload = {
	token: state.token,
	groupId: state.currentGroup,
	category: document.getElementById('category').value,
	desc: document.getElementById('desc').value,
	remark: document.getElementById('remark').value,
	amount: amount,
	payer: document.getElementById('payer').value,
	shares: shares,
	type: 'EXPENSE',
	date: new Date().toISOString().split('T')[0],
	imageBase64: currentBase64Image
  };

  callGas('addTransaction', payload)
	.then((data) => {
	  hideLoading();
	  if (submitBtn) submitBtn.disabled = false;
	  renderApp(data);
	  document.getElementById('expenseForm').reset();
	  document.getElementById('amountDisplay').value = '0';
	  removeImage('imgPreview', 'imgPreviewContainer', 'receiptImg');
	  calcExpr = '0';
	  renderFormOptions(data.members);
	})
	.catch((err) => { 
	  hideLoading(); 
	  if (submitBtn) submitBtn.disabled = false;
	  alert('新增消費失敗：' + err.message); 
	});
}

function handleDeleteExpense(expenseId) {
  if (!confirm('確定要刪除這筆開銷紀錄？')) return;
  
  const deleteBtn = document.getElementById('btnDeleteDetailExpense');
  if (deleteBtn) deleteBtn.disabled = true;

  closeExpenseDetailModal();
  showLoading();

  callGas('deleteExpense', { token: state.token, groupId: state.currentGroup, expenseId })
	.then((data) => {
	  hideLoading();
	  if (deleteBtn) deleteBtn.disabled = false;
	  renderApp(data);
	})
	.catch((err) => { 
	  hideLoading(); 
	  if (deleteBtn) deleteBtn.disabled = false;
	  alert('刪除失敗：' + err.message); 
	});
}

function fillRemainingForUser(memberName) {
  const totalAmount = parseFloat(document.getElementById('detailAmountDisplay').value) || 0;
  let currentSharesSum = 0;

  if (state.appData && state.appData.members) {
	state.appData.members.forEach(m => {
	  if (m !== memberName) {
		const inputElem = document.getElementById(`detail-share-input-${m}`);
		if (inputElem) {
		  currentSharesSum += parseFloat(inputElem.value) || 0;
		}
	  }
	});
  }

  const remaining = Math.max(0, Math.round((totalAmount - currentSharesSum) * 10) / 10);
  const targetInput = document.getElementById(`detail-share-input-${memberName}`);
  const targetCb = document.querySelector(`input[name="detailParts"][value="${memberName}"]`);

  if (targetCb && !targetCb.checked) {
	targetCb.checked = true;
	handleCheckboxChange(memberName, 'detailParts', 'detail-share-input-', true);
  }

  if (targetInput) {
	targetInput.value = remaining;
	updateRemainingCalculation();
  }
}

function openExpenseDetailModal(expenseId) {
  if (!state.appData || !state.appData.expenses) return;
  const exp = state.appData.expenses.find(e => e.id === expenseId);
  if (!exp) return;

  currentEditingExpenseId = expenseId;

  document.getElementById('detailCategory').value = exp.category;
  document.getElementById('detailDesc').value = exp.desc || '';
  document.getElementById('detailRemark').value = exp.remark || '';
  document.getElementById('detailAmountDisplay').value = exp.amount || 0;
  document.getElementById('expenseStatus').value = exp.status || '未完成付款';

  const payerSelect = document.getElementById('detailPayer');
  const members = state.appData.members || [];
  payerSelect.innerHTML = members.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
  payerSelect.value = exp.payer;

  detailBase64Image = exp.imageUrl || '';
  const imgPreviewContainer = document.getElementById('detailImgPreviewContainer');
  if (exp.imageUrl) {
	document.getElementById('detailImgPreview').src = exp.imageUrl;
	document.getElementById('detailImgLink').href = exp.imageUrl;
	imgPreviewContainer.classList.remove('hidden');
  } else {
	imgPreviewContainer.classList.add('hidden');
  }

  const status = getExpenseStatus(exp);
  const statusBadge = document.getElementById('detailStatusBadge');
  statusBadge.innerText = status;

  if (status === '未完成分帳') {
	statusBadge.className = 'text-xs md:text-sm font-bold px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] bg-yellow-400 text-black';
  } else if (status === '未完成付款') {
	statusBadge.className = 'text-xs md:text-sm font-bold px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] bg-red-500 text-white';
  } else {
	statusBadge.className = 'text-xs md:text-sm font-bold px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] bg-green-500 text-white';
  }

  const partGroup = document.getElementById('detailParticipantsGroup');
  const shares = exp.shares || {};

  partGroup.innerHTML = members.map(m => {
	const shareVal = parseFloat(shares[m]) || 0;
	const isChecked = shares.hasOwnProperty(m) && shareVal >= 0 && (exp.participants && exp.participants.includes(m));
	const isMe = state.currentUser && m === state.currentUser.memberName;
	const safeName = escapeHTML(m);

	return `
	  <div class="flex items-center justify-between border-2 border-black p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-[2px_2px_0px_#000]">
		<div class="flex items-center space-x-2">
		  <label class="flex items-center space-x-1.5 cursor-pointer text-xs md:text-sm font-black">
			<input type="checkbox" name="detailParts" value="${safeName}" ${isChecked ? 'checked' : ''} onchange="handleCheckboxChange('${safeName}', 'detailParts', 'detail-share-input-', true)" class="w-4 h-4 rounded text-red-600 focus:ring-0 accent-red-600">
			<span>${safeName}</span>
		  </label>
		  ${isMe ? `
			<button type="button" onclick="fillRemainingForUser('${safeName}')" class="text-[10px] md:text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded border border-black font-black hover:opacity-90">
			  ⚡ 填入個人餘額
			</button>
		  ` : ''}
		</div>
		<div class="flex items-center space-x-1">
		  <span class="text-xs md:text-sm font-bold text-yellow-500 dark:text-yellow-400">$</span>
		  <div class="relative flex items-center">
			<input type="text" readonly id="detail-share-input-${safeName}" value="${shareVal}" ${isChecked ? '' : 'disabled'}
				   onclick="openCalcModal('detail-share-input-${safeName}')"
				   onchange="updateRemainingCalculation()"
				   class="w-20 md:w-24 bg-white dark:bg-slate-900 text-slate-900 dark:text-yellow-400 text-xs md:text-sm font-mono font-black border border-black rounded-lg px-1.5 py-1 text-right focus:outline-none cursor-pointer">
		  </div>
		</div>
	  </div>
	`;
  }).join('');

  document.getElementById('btnDeleteDetailExpense').onclick = function() {
	handleDeleteExpense(exp.id);
  };

  const btnDetail = document.getElementById('btnToggleSelectDetail');
  if (btnDetail) btnDetail.innerText = '全選';

  updateRemainingCalculation();

  const overlay = document.getElementById('expenseDetailOverlay');
  const drawer = document.getElementById('expenseDetailDrawer');
  document.body.style.overflow = 'hidden';
  overlay.classList.remove('opacity-0', 'pointer-events-none');
  overlay.classList.add('pointer-events-auto');
  drawer.classList.remove('translate-y-full');
  drawer.classList.add('translate-y-0');
}

function updateRemainingCalculation() {
  const totalAmount = parseFloat(document.getElementById('detailAmountDisplay').value) || 0;
  let currentSharesSum = 0;

  if (state.appData && state.appData.members) {
	state.appData.members.forEach(member => {
	  const cb = document.querySelector(`input[name="detailParts"][value="${member}"]`);
	  if (cb && cb.checked) {
		const inputElem = document.getElementById(`detail-share-input-${member}`);
		if (inputElem) {
		  currentSharesSum += parseFloat(inputElem.value) || 0;
		}
	  }
	});
  }

  const remaining = Math.round((totalAmount - currentSharesSum) * 10) / 10;
  const remainingElem = document.getElementById('detailRemainingAmount');
  const badgeElem = document.getElementById('detailRemainingBadge');

  remainingElem.innerText = `$${remaining}`;

  if (remaining > 0) {
	badgeElem.className = 'text-[10px] md:text-xs font-black px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] bg-red-500 text-white';
  } else if (remaining < 0) {
	badgeElem.className = 'text-[10px] md:text-xs font-black px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] bg-orange-400 text-black';
  } else {
	badgeElem.className = 'text-[10px] md:text-xs font-black px-2 py-0.5 rounded-lg border border-black shadow-[1px_1px_0px_#000] bg-green-500 text-white';
  }
}

function closeExpenseDetailModal() {
  const overlay = document.getElementById('expenseDetailOverlay');
  const drawer = document.getElementById('expenseDetailDrawer');

  document.body.style.overflow = '';
  overlay.classList.add('opacity-0', 'pointer-events-none');
  overlay.classList.remove('pointer-events-auto');
  drawer.classList.remove('translate-y-0');
  drawer.classList.add('translate-y-full');
}

function saveDetailShares(e) {
  if (e) e.preventDefault();
  if (!currentEditingExpenseId) return;

  const checkedBoxes = Array.from(document.querySelectorAll('input[name="detailParts"]:checked'));
  if (checkedBoxes.length === 0) return alert('請至少選擇一位分攤車手！');

  let amount = parseFloat(document.getElementById('detailAmountDisplay').value) || 0;
  const updatedShares = {};
  let totalSharesSum = 0;

  checkedBoxes.forEach(cb => {
	const val = parseFloat(document.getElementById(`detail-share-input-${cb.value}`).value) || 0;
	updatedShares[cb.value] = val;
	totalSharesSum += val;
  });

  if (totalSharesSum > 0 && amount === 0) {
	amount = totalSharesSum;
  }

  const saveBtn = document.getElementById('btnSaveDetail');
  if (saveBtn) saveBtn.disabled = true;

  closeExpenseDetailModal();
  showLoading();
  
  console.log(document.getElementById('expenseStatus').value)

  callGas('updateExpenseShares', {
	token: state.token,
	groupId: state.currentGroup,
	expenseId: currentEditingExpenseId,
	category: document.getElementById('detailCategory').value,
	desc: document.getElementById('detailDesc').value,
	remark: document.getElementById('detailRemark').value,
	payer: document.getElementById('detailPayer').value,
	amount: amount,
	shares: updatedShares,
	imageBase64: detailBase64Image,
	status: document.getElementById('expenseStatus') ? document.getElementById('expenseStatus').value : '未完成付款'
  })
  .then((data) => {
	hideLoading();
	if (saveBtn) saveBtn.disabled = false;
	renderApp(data);
  })
  .catch((err) => {
	hideLoading();
	if (saveBtn) saveBtn.disabled = false;
	alert('更新失敗：' + err.message);
  });
  
  currentEditingExpenseId = null;
}

function renderBalances(balances) {
  const container = document.getElementById('balanceList');
  if (!balances || Object.keys(balances).length === 0) {
	container.innerHTML = '<p class="text-xs md:text-sm text-slate-500 py-2">尚未招募成員</p>';
	return;
  }

  const myName = state.currentUser ? state.currentUser.memberName : null;
  let myHtml = '';
  let othersHtml = '';

  for (const [name, val] of Object.entries(balances)) {
	const rounded = Math.round(val * 10) / 10;
	let colorClass = 'text-slate-400', statusText = '已結清';
	if (rounded > 0) { colorClass = 'text-green-500 font-black'; statusText = `應收 $${rounded}`; }
	else if (rounded < 0) { colorClass = 'text-red-500 font-black'; statusText = `應付 $${Math.abs(rounded)}`; }

	const safeName = escapeHTML(name);
	const itemHtml = `
	  <div class="flex justify-between items-center py-2 ${name === myName ? 'bg-yellow-400/10 -mx-1 px-2 rounded-xl border border-yellow-400/50' : ''}">
		<span class="font-black text-slate-800 dark:text-slate-200">
		  ${name === myName ? '🙋‍♂️ ' + safeName + ' (我)' : '🏎️ ' + safeName}
		</span>
		<span class="${colorClass}">${statusText}</span>
	  </div>`;

	if (name === myName) {
	  myHtml += itemHtml;
	} else {
	  othersHtml += itemHtml;
	}
  }

  container.innerHTML = `
	${myHtml ? `
	  <div class="mb-2">
		<div class="text-[10px] md:text-xs font-black text-yellow-500 dark:text-yellow-400 mb-1">🙋‍♂️ 我的戰報</div>
		${myHtml}
	  </div>
	` : ''}
	${othersHtml ? `
	  <div class="pt-2 border-t border-slate-200 dark:border-slate-800">
		<div class="text-[10px] md:text-xs font-black text-slate-400 mb-1">👥 其他車手戰報</div>
		${othersHtml}
	  </div>
	` : ''}
  `;
}

function renderSettlements(settlements) {
  const container = document.getElementById('settlementList');
  if (!settlements || settlements.length === 0) {
	container.innerHTML = '<p class="text-xs md:text-sm text-slate-500 font-bold">目前無欠款，全員平手！✨</p>';
	return;
  }

  const myName = state.currentUser ? state.currentUser.memberName : null;
  const mySettlements = [];
  const otherSettlements = [];

  settlements.forEach(s => {
	if (s.from === myName || s.to === myName) {
	  mySettlements.push(s);
	} else {
	  otherSettlements.push(s);
	}
  });

  const createItemCard = (s, isMySettlement = false) => {
	const safeFrom = escapeHTML(s.from);
	const safeTo = escapeHTML(s.to);
	return `
	<div class="flex justify-between items-center bg-slate-100 dark:bg-slate-800 border-2 ${isMySettlement ? 'border-yellow-400' : 'border-black'} p-2.5 rounded-xl text-xs md:text-sm font-black shadow-[2px_2px_0px_#000]">
	  <span class="text-slate-800 dark:text-slate-200">
		🏎️ <b>${s.from === myName ? '我' : safeFrom}</b> ➔ <b>${s.to === myName ? '我' : safeTo}</b> 
		<b class="text-red-500">$${s.amount}</b>
	  </span>
	  <button onclick="openSettleModal('${safeFrom}', '${safeTo}', ${s.amount})" class="nfs-btn-green text-[10px] md:text-xs font-nfs px-2 py-1 rounded-lg">
		DRIFT 還款
	  </button>
	</div>
  `;
  };

  let html = '';

  if (mySettlements.length > 0) {
	html += `
	  <div class="space-y-2 mb-3">
		<div class="text-[10px] md:text-xs font-black text-yellow-500 dark:text-yellow-400">⚡ 與我有關的還款事項</div>
		${mySettlements.map(s => createItemCard(s, true)).join('')}
	  </div>
	`;
  }

  if (otherSettlements.length > 0) {
	html += `
	  <div class="space-y-2">
		<div class="text-[10px] md:text-xs font-black text-slate-400">👥 其他車手的還款事項</div>
		${otherSettlements.map(s => createItemCard(s, false)).join('')}
	  </div>
	`;
  }

  container.innerHTML = html;
}

function openSettleModal(from, to, amount) {
  activeSettleData = { from, to, amount };
  document.getElementById('settleInfo').innerText = `【${from}】還款給【${to}】`;
  document.getElementById('settleAmountInput').value = amount;
  document.getElementById('settleModal').classList.remove('hidden');
}

function closeSettleModal() {
  document.getElementById('settleModal').classList.add('hidden');
  //activeSettleData = null;
}

function confirmSettle() {
  if (!activeSettleData) return;
  const amount = parseFloat(document.getElementById('settleAmountInput').value);
  if (isNaN(amount) || amount <= 0) return alert('請輸入正確的金額');

  const settleBtn = document.getElementById('btnConfirmSettle');
  if (settleBtn) settleBtn.disabled = true;

  closeSettleModal();
  showLoading();

  // 取得台灣/香港當地的 YYYY-MM-DD 日期，避免 UTC 時間差問題
  const now = new Date();
  const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  // 整理要發送的資料 payload (清理掉重複的 action 避免重複包裝)
  const payload = {
	token: state.token,
	groupId: state.currentGroup,
	category: '💵 還款',
	desc: `【${activeSettleData.from}】還款給【${activeSettleData.to}】`,
	amount: amount,
	payer: activeSettleData.from,
	shares: { [activeSettleData.to]: amount },
	type: 'PAYMENT',
	date: localDate
  };

  // 呼叫 callGas API
  callGas('addTransaction', payload)
	.then((data) => {
	  hideLoading();
	  if (settleBtn) settleBtn.disabled = false;
	  // 檢查回傳資料是否有錯
	  if (data && data.error) {
		alert('還款失敗：' + data.error);
		return;
	  }
	  renderApp(data);
	})
	.catch((err) => { 
	  hideLoading();
	  if (settleBtn) settleBtn.disabled = false;
	  alert('還款失敗：' + (err.message || err)); 
	});
	
}

function filterFeed() {
  if (state.appData && state.appData.expenses) {
	renderFeed(state.appData.expenses);
  }
}

function renderFeed(expenses) {
  const container = document.getElementById('expensesFeed');
  const catFilter = document.getElementById('filterCategory').value;

  if (!expenses || expenses.length === 0) {
	container.innerHTML = '<p class="text-xs md:text-sm text-slate-500 py-4 text-center">賽道上尚無任何明細紀錄 🏎️💨</p>';
	return;
  }

  let filtered = expenses;
  if (catFilter !== 'ALL') {
	filtered = expenses.filter(e => {
	  if (catFilter === '💵 還款' || catFilter === '還款') {
		return e.type === 'PAYMENT' || (e.category && e.category.includes('還款'));
	  }
	  return e.category === catFilter;
	});
  }

  if (filtered.length === 0) {
	container.innerHTML = '<p class="text-xs md:text-sm text-slate-500 py-4 text-center">無符合該類別的明細紀錄。</p>';
	return;
  }

  container.innerHTML = filtered.map(exp => {
	const isPayment = exp.type === 'PAYMENT';
	const isExpense = !isPayment;
	
	let statusBadge = '';
	if (isExpense) {
	  const status = getExpenseStatus(exp);
	  if (status === '未完成分帳') {
		statusBadge = '<span class="text-[10px] md:text-xs font-bold px-1.5 py-0.5 bg-yellow-400 text-black border border-black rounded shadow-[1px_1px_0px_#000]">未完成分帳</span>';
	  } else if (status === '未完成付款') {
		statusBadge = '<span class="text-[10px] md:text-xs font-bold px-1.5 py-0.5 bg-red-500 text-white border border-black rounded shadow-[1px_1px_0px_#000]">未完成付款</span>';
	  } else {
		statusBadge = '<span class="text-[10px] md:text-xs font-bold px-1.5 py-0.5 bg-green-500 text-white border border-black rounded shadow-[1px_1px_0px_#000]">已結清</span>';
	  }
	}

	const categoryText = escapeHTML(exp.category || (isPayment ? '💵 還款' : '💡 雜項'));
	const descText = escapeHTML(exp.desc || '');
	const payerText = escapeHTML(exp.payer || '');
	const remarkText = escapeHTML(exp.remark || '');
	const dateText = escapeHTML(exp.date || '');

	return `
	  <div onclick="openExpenseDetailModal('${escapeHTML(exp.id)}')" 
		   class="py-3 flex justify-between items-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors px-1 rounded-xl">
		<div class="space-y-1 max-w-[65%]">
		  <div class="flex items-center space-x-1.5 flex-wrap gap-y-1">
			<span class="text-[10px] md:text-xs font-black bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-yellow-400 border border-black px-1.5 py-0.5 rounded shadow-[1px_1px_0px_#000]">
			  ${categoryText}
			</span>
			<span class="text-xs md:text-sm font-black text-slate-900 dark:text-white truncate">
			  ${descText}
			</span>
			${statusBadge}
		  </div>
		  <div class="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center space-x-2">
			<span>🏎️ ${payerText} 先付</span>
			<span>•</span>
			<span>📅 ${dateText}</span>
		  </div>
		  ${remarkText ? `<div class="text-[10px] md:text-xs text-yellow-600 dark:text-yellow-400 font-bold italic">💬 ${remarkText}</div>` : ''}
		</div>

		<div class="text-right">
		  <div class="font-mono text-base md:text-lg font-black ${isPayment ? 'text-green-500' : 'text-slate-900 dark:text-yellow-400'}">
			$${(parseFloat(exp.amount) || 0).toLocaleString()}
		  </div>
		</div>
	  </div>
	`;
  }).join('');
}
