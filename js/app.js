'use strict';

const ADMIN_PIN = '2580';

const state = {
	currentScreen: '1',
	selectedCompany: null,
	selectedWorkerId: null,
	companies: ['Rivimetal', 'Dismecamo', 'Nalucha'],
	workers: [
		{ id: 'w1', nombre: 'Carlos Mena', dni: '12345678A', empresa: 'Rivimetal', email: 'carlos@empresa.com', estado: 'fuera', activo: true },
		{ id: 'w2', nombre: 'Lucia Perez', dni: '21123456B', empresa: 'Rivimetal', email: 'lucia@empresa.com', estado: 'en_jornada', activo: true },
		{ id: 'w3', nombre: 'Sergio Diaz', dni: '33444555C', empresa: 'Dismecamo', email: 'sergio@empresa.com', estado: 'en_pausa', activo: true },
		{ id: 'w4', nombre: 'Noelia Ruiz', dni: '44555666D', empresa: 'Nalucha', email: 'noelia@empresa.com', estado: 'fuera', activo: true }
	],
	logs: []
};

const screenEls = Array.from(document.querySelectorAll('.screen'));
const dateTimeEl = document.getElementById('currentDateTime');
const toastEl = document.getElementById('toast');

const companyGridEl = document.getElementById('companyGrid');
const workersTitleEl = document.getElementById('workersTitle');
const workerSearchEl = document.getElementById('workerSearch');
const workersListEl = document.getElementById('workersList');

const actionWorkerNameEl = document.getElementById('actionWorkerName');
const actionCompanyNameEl = document.getElementById('actionCompanyName');
const actionStateChipEl = document.getElementById('actionStateChip');
const actionButtonsEl = document.getElementById('actionButtons');
const geoStatusEl = document.getElementById('geoStatus');
const geoCoordsEl = document.getElementById('geoCoords');

const adminPinEl = document.getElementById('adminPin');
const addWorkerCompanyEl = document.getElementById('addWorkerCompany');
const addWorkerFormEl = document.getElementById('addWorkerForm');

const editWorkerSelectEl = document.getElementById('editWorkerSelect');
const editWorkerFormEl = document.getElementById('editWorkerForm');
const editNameEl = document.getElementById('editName');
const editCompanyEl = document.getElementById('editCompany');
const editActiveEl = document.getElementById('editActive');

const logCompanyFilterEl = document.getElementById('logCompanyFilter');
const logWorkerFilterEl = document.getElementById('logWorkerFilter');
const fromDateEl = document.getElementById('fromDate');
const toDateEl = document.getElementById('toDate');
const logsTableEl = document.getElementById('logsTable');

function formatDateTime(date) {
	return new Intl.DateTimeFormat('es-ES', {
		dateStyle: 'full',
		timeStyle: 'medium'
	}).format(date);
}

function tickClock() {
	dateTimeEl.textContent = formatDateTime(new Date());
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
	}, 2200);
}

function gotoScreen(id) {
	state.currentScreen = String(id);
	screenEls.forEach((screen) => {
		screen.classList.toggle('active', screen.dataset.screen === state.currentScreen);
	});

	if (state.currentScreen === '3') {
		renderWorkers();
	}
	if (state.currentScreen === '4') {
		renderActionScreen();
	}
	if (state.currentScreen === '8') {
		hydrateEditWorkers();
	}
	if (state.currentScreen === '9') {
		hydrateLogFilters();
		renderLogs();
	}
}

function companyHint(name) {
	if (name === 'Rivimetal') return 'Centro principal';
	if (name === 'Dismecamo') return 'Linea industrial';
	return 'Planta auxiliar';
}

function renderCompanyCards() {
	companyGridEl.innerHTML = '';
	state.companies.forEach((company) => {
		const btn = document.createElement('button');
		btn.className = 'company-card';
		btn.innerHTML = `${company}<small>${companyHint(company)}</small>`;
		btn.addEventListener('click', () => {
			state.selectedCompany = company;
			workerSearchEl.value = '';
			gotoScreen(3);
		});
		companyGridEl.appendChild(btn);
	});
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

function renderWorkers() {
	const company = state.selectedCompany;
	workersTitleEl.textContent = `Trabajadores de ${company || '-'}`;
	const query = workerSearchEl.value.trim().toLowerCase();
	const workers = state.workers.filter((w) => w.empresa === company && w.activo);
	const filtered = workers.filter((w) => {
		if (!query) return true;
		return w.nombre.toLowerCase().includes(query) || w.dni.toLowerCase().includes(query);
	});

	workersListEl.innerHTML = '';
	if (!filtered.length) {
		workersListEl.innerHTML = '<p class="muted">No hay trabajadores para este filtro.</p>';
		return;
	}

	filtered.forEach((worker) => {
		const row = document.createElement('article');
		row.className = 'worker-row';
		row.innerHTML = `
			<div class="worker-main">
				<strong>${worker.nombre}</strong>
				<small class="muted">DNI: ${worker.dni}</small>
			</div>
			<span class="${getStateClass(worker.estado)}">${getStateLabel(worker.estado)}</span>
			<button class="btn btn-primary">Fichar</button>
		`;
		row.querySelector('button').addEventListener('click', () => {
			state.selectedWorkerId = worker.id;
			gotoScreen(4);
			requestGeo();
		});
		workersListEl.appendChild(row);
	});
}

function selectedWorker() {
	return state.workers.find((worker) => worker.id === state.selectedWorkerId) || null;
}

function requestGeo() {
	geoStatusEl.textContent = 'Solicitando...';
	geoCoordsEl.textContent = '';
	if (!navigator.geolocation) {
		geoStatusEl.textContent = 'No disponible en este dispositivo';
		showToast('Geolocalizacion no disponible', 'warn');
		return;
	}

	navigator.geolocation.getCurrentPosition(
		(pos) => {
			const lat = pos.coords.latitude.toFixed(5);
			const lng = pos.coords.longitude.toFixed(5);
			geoStatusEl.textContent = 'Detectada';
			geoCoordsEl.textContent = `Lat ${lat}, Lng ${lng}`;
		},
		() => {
			geoStatusEl.textContent = 'Sin permisos o error de GPS';
			showToast('Geolocalizacion no disponible', 'warn');
		},
		{ enableHighAccuracy: true, timeout: 4500 }
	);
}

function actionsByWorkerState(workerState) {
	if (workerState === 'fuera') return [{ key: 'entrada', label: 'Entrada', nextState: 'en_jornada' }];
	if (workerState === 'en_jornada') {
		return [
			{ key: 'pausa', label: 'Pausa', nextState: 'en_pausa' },
			{ key: 'salida', label: 'Salida', nextState: 'fuera' }
		];
	}
	return [{ key: 'reanudar', label: 'Reanudar', nextState: 'en_jornada' }];
}

function renderActionScreen() {
	const worker = selectedWorker();
	if (!worker) {
		gotoScreen(3);
		return;
	}

	actionWorkerNameEl.textContent = worker.nombre;
	actionCompanyNameEl.textContent = worker.empresa;
	actionStateChipEl.className = getStateClass(worker.estado);
	actionStateChipEl.textContent = getStateLabel(worker.estado);

	actionButtonsEl.innerHTML = '';
	const actions = actionsByWorkerState(worker.estado);
	actions.forEach((action) => {
		const btn = document.createElement('button');
		btn.className = 'btn btn-primary';
		btn.textContent = action.label;
		btn.addEventListener('click', () => registerCheckin(worker, action));
		actionButtonsEl.appendChild(btn);
	});
}

function registerCheckin(worker, action) {
	const now = new Date();
	const log = {
		id: `log_${Date.now()}`,
		workerId: worker.id,
		workerName: worker.nombre,
		company: worker.empresa,
		event: action.key,
		timestamp: now.toISOString(),
		location: geoCoordsEl.textContent || 'No disponible',
		device: 'Tablet Terminal'
	};

	state.logs.unshift(log);
	worker.estado = action.nextState;
	showToast('Fichaje registrado correctamente');
	gotoScreen(3);
}

function setupNavigation() {
	document.getElementById('goToCheckin').addEventListener('click', () => gotoScreen(2));
	document.getElementById('goToAdminPin').addEventListener('click', () => gotoScreen(5));

	document.querySelectorAll('[data-nav]').forEach((btn) => {
		btn.addEventListener('click', () => gotoScreen(btn.dataset.nav));
	});
}

function setupAdminPin() {
	document.getElementById('submitPin').addEventListener('click', () => {
		const pin = adminPinEl.value.trim();
		if (pin === ADMIN_PIN) {
			adminPinEl.value = '';
			gotoScreen(6);
			showToast('Acceso permitido');
			return;
		}
		showToast('PIN incorrecto', 'error');
	});

	document.getElementById('logoutAdmin').addEventListener('click', () => {
		gotoScreen(1);
		showToast('Sesion RRHH cerrada');
	});
}

function hydrateCompanySelects() {
	addWorkerCompanyEl.innerHTML = '';
	editCompanyEl.innerHTML = '';
	logCompanyFilterEl.innerHTML = '<option value="all">Todas</option>';

	state.companies.forEach((company) => {
		addWorkerCompanyEl.add(new Option(company, company));
		editCompanyEl.add(new Option(company, company));
		logCompanyFilterEl.add(new Option(company, company));
	});
}

function setupAddWorkerForm() {
	addWorkerFormEl.addEventListener('submit', (event) => {
		event.preventDefault();
		const form = new FormData(addWorkerFormEl);
		const nombre = `${form.get('nombre').toString().trim()} ${form.get('apellidos').toString().trim()}`.trim();
		const dni = form.get('dni').toString().trim().toUpperCase();

		if (!nombre || !dni) {
			showToast('Completa los campos obligatorios', 'warn');
			return;
		}

		state.workers.push({
			id: `w${Date.now()}`,
			nombre,
			dni,
			empresa: form.get('empresa').toString(),
			email: form.get('email').toString().trim(),
			estado: 'fuera',
			activo: true
		});

		addWorkerFormEl.reset();
		showToast('Trabajador anadido');
	});
}

function hydrateEditWorkers() {
	const prev = editWorkerSelectEl.value;
	editWorkerSelectEl.innerHTML = '';
	state.workers.forEach((worker) => {
		editWorkerSelectEl.add(new Option(`${worker.nombre} (${worker.empresa})`, worker.id));
	});

	if (prev && state.workers.some((w) => w.id === prev)) {
		editWorkerSelectEl.value = prev;
	}
	loadSelectedWorkerIntoForm();
}

function loadSelectedWorkerIntoForm() {
	const worker = state.workers.find((w) => w.id === editWorkerSelectEl.value);
	if (!worker) return;
	editNameEl.value = worker.nombre;
	editCompanyEl.value = worker.empresa;
	editActiveEl.value = worker.activo ? 'activo' : 'inactivo';
}

function setupEditWorkerForm() {
	editWorkerSelectEl.addEventListener('change', loadSelectedWorkerIntoForm);
	editWorkerFormEl.addEventListener('submit', (event) => {
		event.preventDefault();
		const worker = state.workers.find((w) => w.id === editWorkerSelectEl.value);
		if (!worker) {
			showToast('No se encontro trabajador', 'error');
			return;
		}

		worker.nombre = editNameEl.value.trim();
		worker.empresa = editCompanyEl.value;
		worker.activo = editActiveEl.value === 'activo';
		showToast('Cambios guardados');
	});
}

function hydrateLogFilters() {
	const selectedCompany = logCompanyFilterEl.value || 'all';
	const selectedWorker = logWorkerFilterEl.value || 'all';

	logWorkerFilterEl.innerHTML = '<option value="all">Todos</option>';
	const companyWorkers = state.workers.filter((worker) => {
		return selectedCompany === 'all' ? true : worker.empresa === selectedCompany;
	});
	companyWorkers.forEach((worker) => {
		logWorkerFilterEl.add(new Option(worker.nombre, worker.id));
	});

	if (selectedWorker !== 'all' && state.workers.some((w) => w.id === selectedWorker)) {
		logWorkerFilterEl.value = selectedWorker;
	}
}

function toDateString(dateIso) {
	return new Date(dateIso).toISOString().slice(0, 10);
}

function renderLogs() {
	const company = logCompanyFilterEl.value || 'all';
	const workerId = logWorkerFilterEl.value || 'all';
	const from = fromDateEl.value;
	const to = toDateEl.value;

	let data = state.logs.slice();
	data = data.filter((log) => (company === 'all' ? true : log.company === company));
	data = data.filter((log) => (workerId === 'all' ? true : log.workerId === workerId));
	data = data.filter((log) => {
		const date = toDateString(log.timestamp);
		if (from && date < from) return false;
		if (to && date > to) return false;
		return true;
	});

	logsTableEl.innerHTML = `
		<div class="log-head">
			<span>Fecha</span>
			<span>Trabajador</span>
			<span>Evento</span>
			<span>Dispositivo</span>
			<span>Ubicacion</span>
		</div>
	`;

	if (!data.length) {
		logsTableEl.innerHTML += '<div class="log-row"><span class="muted">Sin registros</span><span></span><span></span><span></span><span></span></div>';
		return;
	}

	data.forEach((log) => {
		const row = document.createElement('div');
		row.className = 'log-row';
		row.innerHTML = `
			<span>${new Date(log.timestamp).toLocaleString('es-ES')}</span>
			<span>${log.workerName}</span>
			<span>${log.event}</span>
			<span>${log.device}</span>
			<span>${log.location}</span>
		`;
		logsTableEl.appendChild(row);
	});
}

function toCsv(rows) {
	const headers = ['fecha', 'trabajador', 'empresa', 'evento', 'dispositivo', 'ubicacion'];
	const lines = [headers.join(',')];
	rows.forEach((row) => {
		const values = [
			new Date(row.timestamp).toLocaleString('es-ES'),
			row.workerName,
			row.company,
			row.event,
			row.device,
			row.location
		].map((value) => `"${String(value).replace(/"/g, '""')}"`);
		lines.push(values.join(','));
	});
	return lines.join('\n');
}

function exportCsv(rows, filename) {
	const csv = toCsv(rows);
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

function setupLogsEvents() {
	[logCompanyFilterEl, logWorkerFilterEl, fromDateEl, toDateEl].forEach((el) => {
		el.addEventListener('change', () => {
			if (el === logCompanyFilterEl) {
				hydrateLogFilters();
			}
			renderLogs();
		});
	});

	document.getElementById('exportFiltered').addEventListener('click', () => {
		const company = logCompanyFilterEl.value || 'all';
		const workerId = logWorkerFilterEl.value || 'all';
		const from = fromDateEl.value;
		const to = toDateEl.value;

		const rows = state.logs.filter((log) => {
			const date = toDateString(log.timestamp);
			if (company !== 'all' && log.company !== company) return false;
			if (workerId !== 'all' && log.workerId !== workerId) return false;
			if (from && date < from) return false;
			if (to && date > to) return false;
			return true;
		});

		if (!rows.length) {
			showToast('No hay registros para exportar', 'warn');
			return;
		}

		exportCsv(rows, `fichajes_${Date.now()}.csv`);
		showToast('CSV exportado');
	});

	document.getElementById('exportAllReports').addEventListener('click', () => {
		if (!state.logs.length) {
			showToast('No hay fichajes aun', 'warn');
			return;
		}
		exportCsv(state.logs, `informes_globales_${Date.now()}.csv`);
		showToast('Informe global exportado');
	});
}

function seedLogs() {
	const baseDate = new Date();
	const samples = [
		{ workerId: 'w2', workerName: 'Lucia Perez', company: 'Rivimetal', event: 'entrada' },
		{ workerId: 'w3', workerName: 'Sergio Diaz', company: 'Dismecamo', event: 'pausa' }
	];
	samples.forEach((sample, index) => {
		const date = new Date(baseDate.getTime() - (index + 1) * 3600 * 1000);
		state.logs.push({
			id: `seed_${index}`,
			...sample,
			timestamp: date.toISOString(),
			location: 'Lat 36.721, Lng -4.421',
			device: 'Tablet Terminal'
		});
	});
}

function boot() {
	tickClock();
	setInterval(tickClock, 1000);

	renderCompanyCards();
	hydrateCompanySelects();
	setupNavigation();
	setupAdminPin();
	setupAddWorkerForm();
	setupEditWorkerForm();
	setupLogsEvents();
	seedLogs();

	workerSearchEl.addEventListener('input', renderWorkers);
	gotoScreen(1);
}

boot();
