'use strict';

const DEMO_WORKERS = [
	{ id: 'w1', nombre: 'Carlos Mena', dni: '12345678A', empresa: 'Rivimetal', email: 'carlos@empresa.com', estado: 'fuera', activo: true },
	{ id: 'w2', nombre: 'Lucia Perez', dni: '21123456B', empresa: 'Rivimetal', email: 'lucia@empresa.com', estado: 'en_jornada', activo: true },
	{ id: 'w3', nombre: 'Sergio Diaz', dni: '33444555C', empresa: 'Dismecamo', email: 'sergio@empresa.com', estado: 'en_pausa', activo: true },
	{ id: 'w4', nombre: 'Noelia Ruiz', dni: '44555666D', empresa: 'Nalucha', email: 'noelia@empresa.com', estado: 'fuera', activo: true }
];

const state = {
	currentWorker: null,
	logs: [],
	currentTab: 'recent'
};

const screenLoginEl = document.getElementById('screen-login');
const screenDashboardEl = document.getElementById('screen-dashboard');
const loginFormEl = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginErrorEl = document.getElementById('loginError');
const logoutBtnEl = document.getElementById('logoutBtn');

const dashboardNameEl = document.getElementById('dashboardName');
const dashboardCompanyEl = document.getElementById('dashboardCompany');
const currentStatusEl = document.getElementById('currentStatus');
const currentTimeEl = document.getElementById('currentTime');
const actionButtonsEl = document.getElementById('actionButtons');
const workerQrCodeEl = document.getElementById('workerQrCode');
const recentLogsEl = document.getElementById('recentLogs');
const historyViewEl = document.getElementById('historyView');
const tabBtnsEl = document.querySelectorAll('.tab-btn');

const toastEl = document.getElementById('toast');

let qrInstance = null;

function formatDateTime(date) {
	return new Intl.DateTimeFormat('es-ES', {
		dateStyle: 'full',
		timeStyle: 'medium'
	}).format(date);
}

function formatTime(date) {
	return new Intl.DateTimeFormat('es-ES', {
		timeStyle: 'short'
	}).format(date);
}

function formatDate(date) {
	return new Intl.DateTimeFormat('es-ES', {
		dateStyle: 'short'
	}).format(date);
}

function showToast(message, type = 'ok') {
	toastEl.className = 'toast';
	if (type === 'error') {
		toastEl.classList.add('error');
	}
	if (type === 'warn') {
		toastEl.classList.add('warn');
	}
	toastEl.textContent = message;
	toastEl.classList.add('show');
	setTimeout(() => {
		toastEl.classList.remove('show');
	}, 2500);
}

function gotoScreen(screenName) {
	document.querySelectorAll('.screen-worker').forEach((screen) => {
		screen.classList.remove('active');
	});
	document.getElementById(`screen-${screenName}`).classList.add('active');
}

function findWorkerByEmail(email) {
	return DEMO_WORKERS.find((w) => w.email.toLowerCase() === email.toLowerCase() && w.activo) || null;
}

function handleLogin(event) {
	event.preventDefault();
	const email = loginEmailEl.value.trim();

	if (!email) {
		loginErrorEl.textContent = 'Por favor introduce un correo';
		return;
	}

	const worker = findWorkerByEmail(email);
	if (!worker) {
		loginErrorEl.textContent = 'Correo no encontrado o trabajador inactivo';
		return;
	}

	state.currentWorker = worker;
	localStorage.setItem('currentWorkerEmail', email);
	loginErrorEl.textContent = '';
	gotoScreen('dashboard');
	renderDashboard();
	startClockUpdate();
}

function logout() {
	state.currentWorker = null;
	localStorage.removeItem('currentWorkerEmail');
	loginFormEl.reset();
	loginErrorEl.textContent = '';
	gotoScreen('login');
	stopClockUpdate();
}

function getStateLabel(value) {
	if (value === 'en_jornada') return 'En jornada';
	if (value === 'en_pausa') return 'En pausa';
	return 'Fuera';
}

function getStateClass(value) {
	if (value === 'en_jornada') return 'state-chip state-in';
	if (value === 'en_pausa') return 'state-chip state-break';
	return 'state-chip state-out';
}

function getActionsByState(workerState) {
	if (workerState === 'fuera') return [{ key: 'entrada', label: 'Entrada', nextState: 'en_jornada' }];
	if (workerState === 'en_jornada') {
		return [
			{ key: 'pausa', label: 'Pausa', nextState: 'en_pausa' },
			{ key: 'salida', label: 'Salida', nextState: 'fuera' }
		];
	}
	return [{ key: 'reanudar', label: 'Reanudar', nextState: 'en_jornada' }];
}

function recordCheckin(action) {
	const now = new Date();
	const log = {
		id: `log_${Date.now()}`,
		event: action.key,
		timestamp: now.toISOString(),
		device: 'Mobile App'
	};

	state.logs.unshift(log);
	state.currentWorker.estado = action.nextState;
	localStorage.setItem(`logs_${state.currentWorker.id}`, JSON.stringify(state.logs));
	
	showToast(`${action.label} registrado correctamente`);
	renderDashboard();
}

function renderActionButtons() {
	const worker = state.currentWorker;
	const actions = getActionsByState(worker.estado);

	actionButtonsEl.innerHTML = '';
	actions.forEach((action) => {
		const btn = document.createElement('button');
		btn.className = 'btn btn-primary';
		btn.textContent = action.label;
		btn.addEventListener('click', () => recordCheckin(action));
		actionButtonsEl.appendChild(btn);
	});
}

function buildWorkerQrPayload() {
	const worker = state.currentWorker;
	return JSON.stringify({
		workerId: worker.id,
		dni: worker.dni,
		nombre: worker.nombre,
		empresa: worker.empresa,
		ts: Date.now()
	});
}

function renderWorkerQr() {
	if (qrInstance) {
		workerQrCodeEl.innerHTML = '';
	}

	const payload = buildWorkerQrPayload();
	qrInstance = new QRCode(workerQrCodeEl, {
		text: payload,
		width: 200,
		height: 200,
		correctLevel: QRCode.CorrectLevel.M
	});
}

function renderLogEntry(log) {
	const date = new Date(log.timestamp);
	const row = document.createElement('div');
	row.className = 'log-entry';
	row.innerHTML = `
		<div class="log-entry-main">
			<span class="log-entry-date">${formatDate(date)}</span>
			<span class="log-entry-time">${formatTime(date)}</span>
		</div>
		<span class="log-entry-event">${log.event}</span>
	`;
	return row;
}

function renderRecentLogs() {
	const recent = state.logs.slice(0, 10);

	recentLogsEl.innerHTML = '';
	if (!recent.length) {
		recentLogsEl.innerHTML = '<div class="logs-empty">Sin fichajes registrados</div>';
		return;
	}

	recent.forEach((log) => {
		recentLogsEl.appendChild(renderLogEntry(log));
	});
}

function renderHistoryLogs() {
	historyViewEl.innerHTML = '';
	if (!state.logs.length) {
		historyViewEl.innerHTML = '<div class="logs-empty">Sin fichajes registrados</div>';
		return;
	}

	state.logs.forEach((log) => {
		historyViewEl.appendChild(renderLogEntry(log));
	});
}

function renderDashboard() {
	const worker = state.currentWorker;

	dashboardNameEl.textContent = worker.nombre;
	dashboardCompanyEl.textContent = worker.empresa;

	currentStatusEl.className = getStateClass(worker.estado);
	currentStatusEl.textContent = getStateLabel(worker.estado);

	currentTimeEl.textContent = formatDateTime(new Date());

	renderActionButtons();
	renderWorkerQr();
	renderRecentLogs();
	renderHistoryLogs();
}

let clockInterval = null;

function startClockUpdate() {
	if (clockInterval) return;
	clockInterval = setInterval(() => {
		if (state.currentWorker) {
			currentTimeEl.textContent = formatDateTime(new Date());
		}
	}, 1000);
}

function stopClockUpdate() {
	if (clockInterval) {
		clearInterval(clockInterval);
		clockInterval = null;
	}
}

function setupTabs() {
	tabBtnsEl.forEach((btn) => {
		btn.addEventListener('click', () => {
			const tab = btn.dataset.tab;
			tabBtnsEl.forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');

			if (tab === 'recent') {
				recentLogsEl.style.display = 'block';
				historyViewEl.style.display = 'none';
			} else {
				recentLogsEl.style.display = 'none';
				historyViewEl.style.display = 'block';
			}
		});
	});
}

function restoreSession() {
	const savedEmail = localStorage.getItem('currentWorkerEmail');
	if (savedEmail) {
		const worker = findWorkerByEmail(savedEmail);
		if (worker) {
			state.currentWorker = worker;
			
			// Recuperar logs del trabajador desde localStorage
			const savedLogs = localStorage.getItem(`logs_${worker.id}`);
			if (savedLogs) {
				try {
					state.logs = JSON.parse(savedLogs);
				} catch {
					state.logs = [];
				}
			}

			gotoScreen('dashboard');
			renderDashboard();
			startClockUpdate();
			return;
		}
	}

	gotoScreen('login');
	loginEmailEl.focus();
}

function boot() {
	loginFormEl.addEventListener('submit', handleLogin);
	logoutBtnEl.addEventListener('click', logout);
	setupTabs();
	restoreSession();
}

boot();
