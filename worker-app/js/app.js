'use strict';

// La app usa el mismo origen desde el que se sirve el backend.
const API_BASE = window.location.origin;

const STORAGE_KEYS = {
	authToken: 'authToken',
	currentWorker: 'currentWorker'
};

const state = {
	currentWorker: null,
	authToken: null,
	logs: [],
	currentTab: 'recent'
};

const screenLoginEl = document.getElementById('screen-login');
const screenDashboardEl = document.getElementById('screen-dashboard');
const loginFormEl = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginErrorEl = document.getElementById('loginError');

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

async function handleLogin(event) {
	event.preventDefault();
	const email = loginEmailEl.value.trim();

	if (!email) {
		loginErrorEl.textContent = 'Por favor introduce un correo';
		return;
	}

	try {
		const response = await fetch(`${API_BASE}/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email })
		});

		if (!response.ok) {
			const error = await response.json();
			loginErrorEl.textContent = error.error || 'Error al autenticar';
			return;
		}

		const data = await response.json();
		state.authToken = data.token;
		state.currentWorker = data.worker;

		localStorage.setItem(STORAGE_KEYS.authToken, data.token);
		localStorage.setItem(STORAGE_KEYS.currentWorker, JSON.stringify(data.worker));

		loginErrorEl.textContent = '';
		gotoScreen('dashboard');
		renderDashboard();
		startClockUpdate();
		loadLogs();
	} catch (err) {
		console.error('Error en login:', err);
		loginErrorEl.textContent = 'Error de conexión. Verifica el backend.';
	}
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
			{ key: 'pausa_inicio', label: 'Pausa', nextState: 'en_pausa' },
			{ key: 'salida', label: 'Salida', nextState: 'fuera' }
		];
	}
	return [{ key: 'pausa_fin', label: 'Reanudar', nextState: 'en_jornada' }];
}

async function recordCheckin(action) {
	try {
		// Obtener geolocalización
		let lat, lon, accuracy_m;
		try {
			const position = await new Promise((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					timeout: 5000,
					enableHighAccuracy: true
				});
			});
			lat = position.coords.latitude;
			lon = position.coords.longitude;
			accuracy_m = position.coords.accuracy;
		} catch (geoErr) {
			console.warn('Geolocalización no disponible:', geoErr);
		}

		const response = await fetch(`${API_BASE}/me/checkin`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${state.authToken}`
			},
			body: JSON.stringify({
				event_type: action.key,
				source: 'mobile',
				lat,
				lon,
				accuracy_m
			})
		});

		if (!response.ok) {
			const error = await response.json();
			showToast(error.error || 'Error al registrar fichaje', 'error');
			return;
		}

		state.currentWorker.estado = action.nextState;
		localStorage.setItem(STORAGE_KEYS.currentWorker, JSON.stringify(state.currentWorker));

		showToast(`${action.label} registrado correctamente`);
		renderDashboard();
		loadLogs();
	} catch (err) {
		console.error('Error al registrar fichaje:', err);
		showToast('Error de conexión', 'error');
	}
}

function renderActionButtons() {
	const worker = state.currentWorker;
	const actions = getActionsByState(worker.estado || 'fuera');

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
		nombre: worker.full_name,
		empresa: worker.company_name,
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
	const date = new Date(log.event_at);
	const row = document.createElement('div');
	row.className = 'log-entry';
	row.innerHTML = `
		<div class="log-entry-main">
			<span class="log-entry-date">${formatDate(date)}</span>
			<span class="log-entry-time">${formatTime(date)}</span>
		</div>
		<span class="log-entry-event">${log.event_type}</span>
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

async function loadLogs() {
	try {
		const response = await fetch(`${API_BASE}/me/logs`, {
			headers: { 'Authorization': `Bearer ${state.authToken}` }
		});

		if (!response.ok) {
			console.error('Error al cargar logs');
			return;
		}

		state.logs = await response.json();
		renderRecentLogs();
		renderHistoryLogs();
	} catch (err) {
		console.error('Error al cargar logs:', err);
	}
}

function renderDashboard() {
	const worker = state.currentWorker;

	dashboardNameEl.textContent = worker.full_name;
	dashboardCompanyEl.textContent = worker.company_name;

	currentStatusEl.className = getStateClass(worker.estado || 'fuera');
	currentStatusEl.textContent = getStateLabel(worker.estado || 'fuera');

	currentTimeEl.textContent = formatDateTime(new Date());

	renderActionButtons();
	renderWorkerQr();
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
	const savedToken = localStorage.getItem(STORAGE_KEYS.authToken);
	const savedWorker = localStorage.getItem(STORAGE_KEYS.currentWorker);

	if (savedToken && savedWorker) {
		try {
			state.authToken = savedToken;
			state.currentWorker = JSON.parse(savedWorker);

			gotoScreen('dashboard');
			renderDashboard();
			startClockUpdate();
			loadLogs();
			return;
		} catch (err) {
			console.error('Error al restaurar sesión:', err);
			localStorage.removeItem(STORAGE_KEYS.authToken);
			localStorage.removeItem(STORAGE_KEYS.currentWorker);
		}
	}

	gotoScreen('login');
	loginEmailEl.focus();
}

function boot() {
	loginFormEl.addEventListener('submit', handleLogin);
	setupTabs();
	restoreSession();
}

boot();
