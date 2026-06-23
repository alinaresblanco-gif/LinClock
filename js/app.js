'use strict';

const ADMIN_PIN = '2580';
const API_BASE = window.location.origin;
const REQUIRE_GEO = false; // Cambiar a true al pasar a produccion con HTTPS.

const state = {
currentScreen: '1',
selectedCompany: null,
selectedWorkerId: null,
companies: [],
workers: [],
logs: [],
currentGeo: null
};

const screenEls = Array.from(document.querySelectorAll('.screen'));
const dateTimeEl = document.getElementById('currentDateTime');
const toastEl = document.getElementById('toast');

const companyGridEl = document.getElementById('companyGrid');
const workersTitleEl = document.getElementById('workersTitle');
const workerSearchEl = document.getElementById('workerSearch');
const workersListEl = document.getElementById('workersList');
const openQrModalEl = document.getElementById('openQrModal');

const qrModalEl = document.getElementById('qrModal');
const qrInputEl = document.getElementById('qrInput');
const submitQrEl = document.getElementById('submitQr');
const closeQrModalEl = document.getElementById('closeQrModal');
const qrStatusEl = document.getElementById('qrStatus');

let qrScanner = null;
let qrScannerActive = false;
let qrReadLock = false;

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

const workerQrCompanySelectEl = document.getElementById('workerQrCompanySelect');
const workerQrSelectEl = document.getElementById('workerQrSelect');
const refreshWorkerQrEl = document.getElementById('refreshWorkerQr');
const copyWorkerQrPayloadEl = document.getElementById('copyWorkerQrPayload');
const workerQrCodeEl = document.getElementById('workerQrCode');
const workerQrLabelEl = document.getElementById('workerQrLabel');
const workerQrPayloadEl = document.getElementById('workerQrPayload');

let workerQrInstance = null;

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
if (type === 'error') toastEl.classList.add('error');
if (type === 'warn') toastEl.classList.add('warn');
toastEl.textContent = message;
toastEl.classList.add('show');
setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function apiFetch(path, options = {}) {
const res = await fetch(`${API_BASE}${path}`, options);
if (!res.ok) {
let errorMessage = `Error ${res.status}`;
try {
const json = await res.json();
errorMessage = json.error || errorMessage;
} catch {
// Ignore JSON parse errors.
}
throw new Error(errorMessage);
}
if (res.status === 204) return null;
return res.json();
}

function getCompanyById(companyId) {
return state.companies.find((company) => company.id === companyId) || null;
}

function getCompanyByName(companyName) {
return state.companies.find((company) => company.name === companyName) || null;
}

function dbEventToUiState(eventType) {
if (eventType === 'entrada') return 'en_jornada';
if (eventType === 'pausa_inicio') return 'en_pausa';
if (eventType === 'pausa_fin') return 'en_jornada';
if (eventType === 'salida') return 'fuera';
return 'fuera';
}

function uiActionToDbEvent(actionKey) {
if (actionKey === 'entrada') return 'entrada';
if (actionKey === 'pausa') return 'pausa_inicio';
if (actionKey === 'reanudar') return 'pausa_fin';
if (actionKey === 'salida') return 'salida';
return actionKey;
}

function dbEventLabel(eventType) {
if (eventType === 'pausa_inicio') return 'pausa';
if (eventType === 'pausa_fin') return 'reanudar';
return eventType;
}

function syncWorkerStatesFromLogs() {
const lastByWorker = new Map();
state.logs.forEach((log) => {
if (!lastByWorker.has(log.workerId)) {
lastByWorker.set(log.workerId, log.event);
}
});

state.workers.forEach((worker) => {
const lastEvent = lastByWorker.get(worker.id);
worker.estado = dbEventToUiState(lastEvent || 'salida');
});
}

async function loadCompanies() {
const rows = await apiFetch('/companies');
state.companies = rows.map((row) => ({
id: row.id,
name: row.name,
cif: row.cif,
isActive: row.is_active
}));
}

async function loadWorkers() {
const rows = await apiFetch('/workers');
state.workers = rows.map((row) => ({
id: row.id,
nombre: row.full_name,
dni: row.dni,
empresa: row.company_name,
email: row.email || '',
estado: 'fuera',
activo: row.is_active,
companyId: row.company_id
}));
}

async function loadLogs() {
const rows = await apiFetch('/attendance-events?limit=5000');
state.logs = rows.map((row) => ({
id: String(row.id),
workerId: row.worker_id,
workerName: row.worker_name,
company: row.company_name,
event: row.event_type,
timestamp: row.event_at,
location: (row.lat != null && row.lon != null) ? `Lat ${Number(row.lat).toFixed(5)}, Lng ${Number(row.lon).toFixed(5)}` : 'No disponible',
device: row.source === 'mobile' ? 'App Trabajador' : 'Tablet Terminal'
}));
}

async function refreshAllData() {
await Promise.all([loadCompanies(), loadWorkers(), loadLogs()]);
syncWorkerStatesFromLogs();
}

async function refreshAllDataSilently() {
try {
await refreshAllData();
} catch {
showToast('No se pudo actualizar datos del servidor', 'warn');
}
}

function rerenderCurrentScreen() {
if (state.currentScreen === '3') renderWorkers();
if (state.currentScreen === '8') hydrateEditWorkers();
if (state.currentScreen === '9') {
hydrateLogFilters();
renderLogs();
}
if (state.currentScreen === '10') {
hydrateWorkerQrCompanyOptions();
hydrateWorkerQrWorkerOptions();
renderWorkerQr();
}
}

function gotoScreen(id) {
state.currentScreen = String(id);
screenEls.forEach((screen) => {
screen.classList.toggle('active', screen.dataset.screen === state.currentScreen);
});

if (state.currentScreen === '3') renderWorkers();
if (state.currentScreen === '4') renderActionScreen();
if (state.currentScreen === '8') hydrateEditWorkers();
if (state.currentScreen === '9') {
hydrateLogFilters();
renderLogs();
}
if (state.currentScreen === '10') {
hydrateWorkerQrCompanyOptions();
hydrateWorkerQrWorkerOptions();
renderWorkerQr();
}

if (state.currentScreen === '3' || state.currentScreen === '9' || state.currentScreen === '10') {
refreshAllDataSilently().then(rerenderCurrentScreen);
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
btn.innerHTML = `${company.name}<small>${companyHint(company.name)}</small>`;
btn.addEventListener('click', () => {
state.selectedCompany = company.name;
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
const workers = state.workers.filter((worker) => worker.empresa === company && worker.activo);
const filtered = workers.filter((worker) => {
if (!query) return true;
return worker.nombre.toLowerCase().includes(query) || worker.dni.toLowerCase().includes(query);
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

async function openQrModal() {
if (!state.selectedCompany) {
showToast('Selecciona primero una empresa', 'warn');
gotoScreen(2);
return;
}

await refreshAllDataSilently();

qrInputEl.value = '';
qrStatusEl.textContent = 'Abre la camara y acerca el QR del trabajador.';
qrModalEl.classList.add('show');
qrModalEl.setAttribute('aria-hidden', 'false');
setTimeout(() => qrInputEl.focus(), 50);
startQrScanner();
}

function closeQrModal() {
qrModalEl.classList.remove('show');
qrModalEl.setAttribute('aria-hidden', 'true');
stopQrScanner();
}

function normalizeQrValue(value) {
const clean = value.trim();
if (!clean) return '';
if (clean.includes(':')) {
const parts = clean.split(':');
return parts[parts.length - 1].trim();
}
return clean;
}

function findWorkerByQr(qrRaw) {
let qrValue = normalizeQrValue(qrRaw);
let qrCompany = '';

try {
const parsed = JSON.parse(qrValue);
if (parsed && typeof parsed === 'object') {
qrValue = String(parsed.workerId || parsed.id || parsed.dni || parsed.nombre || '').trim();
qrCompany = String(parsed.empresa || parsed.company || '').trim();
}
} catch {
// If it's not JSON, use plain value as ID/DNI/name.
}

const lookup = qrValue.toLowerCase();
if (!lookup) {
return { worker: null, companyMismatch: false };
}

const worker = state.workers.find((item) => {
return item.id.toLowerCase() === lookup
|| item.dni.toLowerCase() === lookup
|| item.nombre.toLowerCase() === lookup;
}) || null;

if (worker && qrCompany && worker.empresa.toLowerCase() !== qrCompany.toLowerCase()) {
return { worker: null, companyMismatch: true };
}

return { worker, companyMismatch: false };
}

async function startQrScanner() {
if (typeof Html5Qrcode === 'undefined') {
qrStatusEl.textContent = 'Lector no disponible. Usa entrada manual.';
return;
}

try {
const cameras = await Html5Qrcode.getCameras();
if (!cameras || !cameras.length) {
qrStatusEl.textContent = 'No se detecta camara. Usa entrada manual.';
return;
}

const rear = cameras.find((cam) => /rear|back|trasera/i.test(cam.label));
const cameraId = (rear || cameras[0]).id;
qrScanner = qrScanner || new Html5Qrcode('qrReader');
if (qrScannerActive) return;

await qrScanner.start(
cameraId,
{ fps: 10, qrbox: { width: 220, height: 220 } },
(decodedText) => {
if (qrReadLock) return;
qrReadLock = true;
submitQrMatch(decodedText, true).finally(() => {
setTimeout(() => { qrReadLock = false; }, 500);
});
},
() => {}
);

qrScannerActive = true;
qrStatusEl.textContent = 'Camara activa. Escaneando QR...';
} catch {
qrStatusEl.textContent = 'No se pudo abrir la camara. Usa entrada manual.';
}
}

async function stopQrScanner() {
if (!qrScanner || !qrScannerActive) return;
try {
await qrScanner.stop();
await qrScanner.clear();
} catch {
// Ignore scanner stop issues when closing modal.
} finally {
qrScannerActive = false;
}
}

async function completeQrFlow(worker, source = 'manual') {
state.selectedWorkerId = worker.id;
const actions = actionsByWorkerState(worker.estado);

if (actions.length === 1) {
closeQrModal();
		if (REQUIRE_GEO) {
			const geoReady = await requestGeo();
			if (!geoReady) {
				showToast('No se puede fichar por QR sin ubicacion GPS', 'error');
				return;
			}
		}
		registerCheckin(worker, actions[0]);
showToast(source === 'camera' ? 'QR leido y fichaje realizado' : 'Fichaje realizado');
return;
}

closeQrModal();
gotoScreen(4);
requestGeo();
showToast('QR valido. Selecciona Pausa o Salida.');
}

async function submitQrMatch(qrRaw = null, fromCamera = false) {
await refreshAllDataSilently();

const payload = qrRaw ?? qrInputEl.value;
const match = findWorkerByQr(payload);
const worker = match.worker;

if (match.companyMismatch) {
showToast('Empresa del QR no coincide', 'warn');
return;
}

if (!worker) {
showToast('QR no valido o trabajador no encontrado', 'error');
return;
}

if (!worker.activo) {
showToast('Trabajador inactivo', 'warn');
return;
}

if (worker.empresa !== state.selectedCompany) {
showToast('El QR no pertenece a la empresa seleccionada', 'warn');
return;
}

await completeQrFlow(worker, fromCamera ? 'camera' : 'manual');
}

function requestGeo() {
state.currentGeo = null;
geoStatusEl.textContent = 'Solicitando...';
geoCoordsEl.textContent = '';
if (!navigator.geolocation) {
geoStatusEl.textContent = 'No disponible en este dispositivo';
showToast('Geolocalizacion no disponible', 'warn');
		return Promise.resolve(false);
}

	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const lat = pos.coords.latitude;
				const lng = pos.coords.longitude;
				state.currentGeo = {
					lat,
					lon: lng,
					accuracy_m: pos.coords.accuracy
				};
				geoStatusEl.textContent = 'Detectada';
				geoCoordsEl.textContent = `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
				resolve(true);
			},
			() => {
				geoStatusEl.textContent = 'Sin permisos o error de GPS';
				showToast('Geolocalizacion no disponible', 'warn');
				resolve(false);
			},
			{ enableHighAccuracy: true, timeout: 7000 }
		);
	});
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

async function registerCheckin(worker, action) {
	if (REQUIRE_GEO && (!state.currentGeo || !Number.isFinite(state.currentGeo.lat) || !Number.isFinite(state.currentGeo.lon))) {
		showToast('No se puede fichar sin ubicacion GPS', 'error');
		return;
	}

try {
await apiFetch('/checkins', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
worker_id: worker.id,
event_type: uiActionToDbEvent(action.key),
lat: state.currentGeo?.lat ?? null,
lon: state.currentGeo?.lon ?? null,
accuracy_m: state.currentGeo?.accuracy_m ?? null
})
});

await loadLogs();
syncWorkerStatesFromLogs();
showToast('Fichaje registrado correctamente');
gotoScreen(3);
renderWorkers();
} catch (error) {
showToast(error.message || 'No se pudo registrar el fichaje', 'error');
}
}

function setupNavigation() {
document.getElementById('goToCheckin').addEventListener('click', () => gotoScreen(2));
document.getElementById('goToAdminPin').addEventListener('click', () => gotoScreen(5));

document.querySelectorAll('[data-nav]').forEach((btn) => {
btn.addEventListener('click', () => gotoScreen(btn.dataset.nav));
});
}

function setupQrModal() {
openQrModalEl.addEventListener('click', openQrModal);
closeQrModalEl.addEventListener('click', closeQrModal);
submitQrEl.addEventListener('click', () => submitQrMatch());

qrInputEl.addEventListener('keydown', (event) => {
if (event.key === 'Enter') {
event.preventDefault();
submitQrMatch();
}
});

qrModalEl.addEventListener('click', (event) => {
if (event.target === qrModalEl) closeQrModal();
});

document.addEventListener('keydown', (event) => {
if (event.key === 'Escape' && qrModalEl.classList.contains('show')) closeQrModal();
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
addWorkerCompanyEl.add(new Option(company.name, company.id));
editCompanyEl.add(new Option(company.name, company.id));
logCompanyFilterEl.add(new Option(company.name, company.name));
});
}

async function setupAddWorkerForm() {
addWorkerFormEl.addEventListener('submit', async (event) => {
event.preventDefault();
const form = new FormData(addWorkerFormEl);
const nombre = `${form.get('nombre').toString().trim()} ${form.get('apellidos').toString().trim()}`.trim();
const dni = form.get('dni').toString().trim().toUpperCase();
const companyId = form.get('empresa').toString();
const email = form.get('email').toString().trim().toLowerCase();

if (!nombre || !dni || !companyId || !email) {
showToast('Completa los campos obligatorios', 'warn');
return;
}

try {
await apiFetch('/workers', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
company_id: companyId,
full_name: nombre,
dni,
email,
is_active: true
})
});

await loadWorkers();
syncWorkerStatesFromLogs();
hydrateEditWorkers();
hydrateLogFilters();
hydrateWorkerQrWorkerOptions();
addWorkerFormEl.reset();
showToast('Trabajador anadido');
} catch (error) {
showToast(error.message || 'No se pudo crear el trabajador', 'error');
}
});
}

function hydrateEditWorkers() {
const prev = editWorkerSelectEl.value;
editWorkerSelectEl.innerHTML = '';
state.workers.forEach((worker) => {
editWorkerSelectEl.add(new Option(`${worker.nombre} (${worker.empresa})`, worker.id));
});

if (prev && state.workers.some((worker) => worker.id === prev)) {
editWorkerSelectEl.value = prev;
}
loadSelectedWorkerIntoForm();
}

function loadSelectedWorkerIntoForm() {
const worker = state.workers.find((item) => item.id === editWorkerSelectEl.value);
if (!worker) return;
editNameEl.value = worker.nombre;
editCompanyEl.value = worker.companyId;
editActiveEl.value = worker.activo ? 'activo' : 'inactivo';
}

function setupEditWorkerForm() {
editWorkerSelectEl.addEventListener('change', loadSelectedWorkerIntoForm);
editWorkerFormEl.addEventListener('submit', async (event) => {
event.preventDefault();
const worker = state.workers.find((item) => item.id === editWorkerSelectEl.value);
if (!worker) {
showToast('No se encontro trabajador', 'error');
return;
}

try {
await apiFetch(`/workers/${worker.id}`, {
method: 'PATCH',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
full_name: editNameEl.value.trim(),
company_id: editCompanyEl.value,
is_active: editActiveEl.value === 'activo'
})
});

await loadWorkers();
syncWorkerStatesFromLogs();
hydrateEditWorkers();
hydrateLogFilters();
hydrateWorkerQrWorkerOptions();
showToast('Cambios guardados');
} catch (error) {
showToast(error.message || 'No se pudo editar el trabajador', 'error');
}
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

if (selectedWorker !== 'all' && state.workers.some((worker) => worker.id === selectedWorker)) {
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
<span>${dbEventLabel(log.event)}</span>
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
dbEventLabel(row.event),
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
if (el === logCompanyFilterEl) hydrateLogFilters();
renderLogs();
});
});

document.getElementById('exportFiltered').addEventListener('click', async () => {
await refreshAllDataSilently();

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

document.getElementById('exportAllReports').addEventListener('click', async () => {
await refreshAllDataSilently();

if (!state.logs.length) {
showToast('No hay fichajes aun', 'warn');
return;
}
exportCsv(state.logs, `informes_globales_${Date.now()}.csv`);
showToast('Informe global exportado');
});
}

function hydrateWorkerQrCompanyOptions() {
const previous = workerQrCompanySelectEl.value;
workerQrCompanySelectEl.innerHTML = '';
state.companies.forEach((company) => {
workerQrCompanySelectEl.add(new Option(company.name, company.id));
});

if (previous && state.companies.some((company) => company.id === previous)) {
workerQrCompanySelectEl.value = previous;
return;
}

const selected = getCompanyByName(state.selectedCompany);
workerQrCompanySelectEl.value = selected?.id || state.companies[0]?.id || '';
}

function hydrateWorkerQrWorkerOptions() {
const companyId = workerQrCompanySelectEl.value;
const previous = workerQrSelectEl.value;
workerQrSelectEl.innerHTML = '';

const companyWorkers = state.workers.filter((worker) => worker.companyId === companyId && worker.activo);
companyWorkers.forEach((worker) => {
workerQrSelectEl.add(new Option(`${worker.nombre} (${worker.dni})`, worker.id));
});

if (!companyWorkers.length) return;

if (previous && companyWorkers.some((worker) => worker.id === previous)) {
workerQrSelectEl.value = previous;
return;
}
workerQrSelectEl.value = companyWorkers[0].id;
}

function buildWorkerQrPayload(worker) {
return JSON.stringify({
workerId: worker.id,
dni: worker.dni,
nombre: worker.nombre,
empresa: worker.empresa,
ts: Date.now()
});
}

function renderWorkerQr() {
const workerId = workerQrSelectEl.value;
const worker = state.workers.find((item) => item.id === workerId && item.activo);

if (!worker) {
workerQrCodeEl.innerHTML = '';
workerQrLabelEl.textContent = 'Sin trabajadores activos en esta empresa';
workerQrPayloadEl.textContent = '';
return;
}

const payload = buildWorkerQrPayload(worker);
workerQrCodeEl.innerHTML = '';
workerQrInstance = new QRCode(workerQrCodeEl, {
text: payload,
width: 220,
height: 220,
correctLevel: QRCode.CorrectLevel.M
});

workerQrLabelEl.textContent = `${worker.nombre} - ${worker.empresa}`;
workerQrPayloadEl.textContent = payload;
}

function setupWorkerQrScreen() {
workerQrCompanySelectEl.addEventListener('change', () => {
hydrateWorkerQrWorkerOptions();
renderWorkerQr();
});

workerQrSelectEl.addEventListener('change', renderWorkerQr);
refreshWorkerQrEl.addEventListener('click', renderWorkerQr);

copyWorkerQrPayloadEl.addEventListener('click', async () => {
const payload = workerQrPayloadEl.textContent.trim();
if (!payload) {
showToast('No hay datos QR para copiar', 'warn');
return;
}
try {
await navigator.clipboard.writeText(payload);
showToast('Datos QR copiados');
} catch {
showToast('No se pudo copiar en este navegador', 'warn');
}
});
}

async function boot() {
tickClock();
setInterval(tickClock, 1000);

setupNavigation();
setupAdminPin();
setupQrModal();
await setupAddWorkerForm();
setupEditWorkerForm();
setupLogsEvents();
setupWorkerQrScreen();

workerSearchEl.addEventListener('input', renderWorkers);

try {
await refreshAllData();
renderCompanyCards();
hydrateCompanySelects();
hydrateEditWorkers();
hydrateLogFilters();
hydrateWorkerQrCompanyOptions();
hydrateWorkerQrWorkerOptions();
renderWorkerQr();
gotoScreen(1);
} catch (error) {
showToast(error.message || 'Error cargando datos del servidor', 'error');
gotoScreen(1);
}
}

boot();
