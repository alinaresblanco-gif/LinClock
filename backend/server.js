import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu-clave-secreta-super-segura';
const REQUIRE_GEO = process.env.REQUIRE_GEO !== 'false';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '..');

// Pool de conexiones PostgreSQL
const pool = new pg.Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

pool.on('error', (err) => {
	console.error('Error en pool de PostgreSQL:', err);
});

// Middleware
app.use(express.json());
app.use(cors({
	origin: process.env.CORS_ORIGIN?.split(',') || '*',
	credentials: true
}));

// Middleware de autenticación JWT
function verifyToken(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader) {
		return res.status(401).json({ error: 'Token requerido' });
	}

	const token = authHeader.replace('Bearer ', '');
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.workerId = decoded.workerId;
		req.workerEmail = decoded.email;
		next();
	} catch (err) {
		res.status(401).json({ error: 'Token inválido o expirado' });
	}
}

function isValidCoordinate(value, min, max) {
	const num = Number(value);
	return Number.isFinite(num) && num >= min && num <= max;
}

// Health check
app.get('/health', (req, res) => {
	res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// STATIC APP
// ============================================================

app.use('/css', express.static(path.join(WEB_ROOT, 'css')));
app.use('/js', express.static(path.join(WEB_ROOT, 'js')));
app.use('/imagenes', express.static(path.join(WEB_ROOT, 'imagenes')));
app.use('/iconos', express.static(path.join(WEB_ROOT, 'iconos')));
app.use('/worker-app', express.static(path.join(WEB_ROOT, 'worker-app')));

app.get('/', (req, res) => {
	res.sendFile(path.join(WEB_ROOT, 'index.html'));
});

app.get('/manifest.json', (req, res) => {
	res.sendFile(path.join(WEB_ROOT, 'manifest.json'));
});

// ============================================================
// AUTH ENDPOINTS
// ============================================================

// POST /auth/login - Login con email (sin contraseña)
app.post('/auth/login', async (req, res) => {
	try {
		const { email } = req.body;

		if (!email || !email.trim()) {
			return res.status(400).json({ error: 'Email requerido' });
		}

		const result = await pool.query(
			`select w.id, w.full_name, w.email, w.company_id, c.name as company_name, w.is_active
			 from public.workers w
			 join public.companies c on w.company_id = c.id
			 where lower(w.email) = lower($1) and w.is_active = true`,
			[email.trim()]
		);

		if (result.rows.length === 0) {
			return res.status(401).json({ error: 'Email no encontrado o trabajador inactivo' });
		}

		const worker = result.rows[0];
		const token = jwt.sign(
			{
				workerId: worker.id,
				email: worker.email,
				fullName: worker.full_name,
				companyId: worker.company_id
			},
			JWT_SECRET,
			{ expiresIn: '30d' }
		);

		res.json({
			token,
			worker: {
				id: worker.id,
				full_name: worker.full_name,
				email: worker.email,
				company_id: worker.company_id,
				company_name: worker.company_name
			}
		});
	} catch (err) {
		console.error('Error en login:', err);
		res.status(500).json({ error: 'Error al autenticar' });
	}
});

// ============================================================
// WORKER ENDPOINTS (requieren autenticación)
// ============================================================

// GET /me/profile - Perfil del trabajador autenticado
app.get('/me/profile', verifyToken, async (req, res) => {
	try {
		const result = await pool.query(
			`select w.id, w.full_name, w.email, w.dni, w.company_id, c.name as company_name, w.is_active
			 from public.workers w
			 join public.companies c on w.company_id = c.id
			 where w.id = $1`,
			[req.workerId]
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Trabajador no encontrado' });
		}

		res.json(result.rows[0]);
	} catch (err) {
		console.error('Error al obtener perfil:', err);
		res.status(500).json({ error: 'Error al obtener perfil' });
	}
});

// GET /me/logs - Fichajes personales (últimos 50)
app.get('/me/logs', verifyToken, async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 50;

		const result = await pool.query(
			`select id, worker_id, event_type, event_at, source, lat, lon, accuracy_m, created_at
			 from public.attendance_events
			 where worker_id = $1
			 order by event_at desc
			 limit $2`,
			[req.workerId, limit]
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Error al obtener logs:', err);
		res.status(500).json({ error: 'Error al obtener fichajes' });
	}
});

// POST /me/checkin - Registrar fichaje
app.post('/me/checkin', verifyToken, async (req, res) => {
	try {
		const { event_type, lat, lon, accuracy_m, qr_payload, source } = req.body;

		if (!event_type || !['entrada', 'pausa_inicio', 'pausa_fin', 'salida'].includes(event_type)) {
			return res.status(400).json({ error: 'event_type inválido' });
		}

		if (!source || !['terminal', 'mobile'].includes(source)) {
			return res.status(400).json({ error: 'source requerido (terminal|mobile)' });
		}

		if (REQUIRE_GEO && (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lon, -180, 180))) {
			return res.status(400).json({ error: 'Ubicacion GPS obligatoria y valida (lat/lon)' });
		}

		// Obtener company_id del trabajador
		const workerResult = await pool.query(
			'select company_id from public.workers where id = $1',
			[req.workerId]
		);

		if (workerResult.rows.length === 0) {
			return res.status(404).json({ error: 'Trabajador no encontrado' });
		}

		const companyId = workerResult.rows[0].company_id;

		const result = await pool.query(
			`insert into public.attendance_events 
			 (worker_id, company_id, source, event_type, event_at, lat, lon, accuracy_m, qr_payload, tz)
			 values ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9)
			 returning id, worker_id, event_type, event_at, source`,
			[req.workerId, companyId, source, event_type, Number(lat), Number(lon), accuracy_m, 
			 qr_payload ? JSON.stringify(qr_payload) : null, 'Europe/Madrid']
		);

		res.status(201).json(result.rows[0]);
	} catch (err) {
		console.error('Error al registrar fichaje:', err);
		res.status(500).json({ error: 'Error al registrar fichaje' });
	}
});

// ============================================================
// TERMINAL ENDPOINTS (públicos, para tablet)
// ============================================================

// GET /companies - Obtener empresas activas
app.get('/companies', async (req, res) => {
	try {
		const result = await pool.query(
			`select id, name, cif, is_active
			 from public.companies
			 where is_active = true
			 order by name asc`
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Error al obtener empresas:', err);
		res.status(500).json({ error: 'Error al obtener empresas' });
	}
});

// GET /attendance-events - Obtener fichajes para informes del terminal
app.get('/attendance-events', async (req, res) => {
	try {
		const companyId = req.query.company_id || null;
		const workerId = req.query.worker_id || null;
		const from = req.query.from || null;
		const to = req.query.to || null;
		const limit = parseInt(req.query.limit || '2000', 10);

		const result = await pool.query(
			`select ae.id,
					  ae.worker_id,
					  w.full_name as worker_name,
					  c.name as company_name,
					  ae.event_type,
					  ae.source,
					  ae.event_at,
					  ae.lat,
					  ae.lon,
					  ae.accuracy_m,
					  ae.created_at
			 from public.attendance_events ae
			 join public.workers w on w.id = ae.worker_id
			 join public.companies c on c.id = ae.company_id
			 where ($1::uuid is null or ae.company_id = $1)
			   and ($2::uuid is null or ae.worker_id = $2)
			   and ($3::timestamptz is null or ae.event_at >= $3)
			   and ($4::timestamptz is null or ae.event_at <= $4)
			 order by ae.event_at desc
			 limit $5`,
			[companyId, workerId, from, to, limit]
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Error al obtener fichajes:', err);
		res.status(500).json({ error: 'Error al obtener fichajes' });
	}
});

// GET /workers - Obtener trabajadores (opcionalmente por empresa)
app.get('/workers', async (req, res) => {
	try {
		const companyId = req.query.company_id || null;

		const result = await pool.query(
			`select w.id,
					  w.full_name,
					  w.dni,
					  w.email,
					  w.company_id,
					  c.name as company_name,
					  w.is_active,
					  w.created_at,
					  w.updated_at
			 from public.workers w
			 join public.companies c on c.id = w.company_id
			 where ($1::uuid is null or w.company_id = $1)
			 order by w.full_name asc`,
			[companyId]
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Error al obtener trabajadores:', err);
		res.status(500).json({ error: 'Error al obtener trabajadores' });
	}
});

// POST /workers - Crear trabajador desde RRHH
app.post('/workers', async (req, res) => {
	try {
		const { company_id, full_name, dni, email, is_active, phone, employee_code } = req.body;

		if (!company_id || !full_name || !dni || !email) {
			return res.status(400).json({ error: 'company_id, full_name, dni y email son requeridos' });
		}

		const result = await pool.query(
			`insert into public.workers
			 (company_id, full_name, dni, email, is_active, phone, employee_code)
			 values ($1, $2, $3, lower($4), coalesce($5, true), $6, $7)
			 returning id, full_name, dni, email, company_id, is_active`,
			[company_id, full_name.trim(), dni.trim().toUpperCase(), email.trim(), is_active, phone || null, employee_code || null]
		);

		res.status(201).json(result.rows[0]);
	} catch (err) {
		console.error('Error al crear trabajador:', err);
		res.status(500).json({ error: 'Error al crear trabajador' });
	}
});

// PATCH /workers/:workerId - Editar trabajador desde RRHH
app.patch('/workers/:workerId', async (req, res) => {
	try {
		const { workerId } = req.params;
		const { company_id, full_name, dni, email, is_active, phone, employee_code } = req.body;

		const result = await pool.query(
			`update public.workers
			 set company_id = coalesce($2, company_id),
				 full_name = coalesce($3, full_name),
				 dni = coalesce($4, dni),
				 email = coalesce(lower($5), email),
				 is_active = coalesce($6, is_active),
				 phone = coalesce($7, phone),
				 employee_code = coalesce($8, employee_code),
				 updated_at = now()
			 where id = $1
			 returning id, full_name, dni, email, company_id, is_active`,
			[
				workerId,
				company_id || null,
				full_name ? full_name.trim() : null,
				dni ? dni.trim().toUpperCase() : null,
				email ? email.trim() : null,
				typeof is_active === 'boolean' ? is_active : null,
				phone || null,
				employee_code || null
			]
		);

		if (!result.rows.length) {
			return res.status(404).json({ error: 'Trabajador no encontrado' });
		}

		res.json(result.rows[0]);
	} catch (err) {
		console.error('Error al editar trabajador:', err);
		res.status(500).json({ error: 'Error al editar trabajador' });
	}
});

// GET /workers/:companyId - Obtener trabajadores de una empresa
app.get('/workers/:companyId', async (req, res) => {
	try {
		const { companyId } = req.params;

		const result = await pool.query(
			`select id, full_name, dni, email, company_id, is_active
			 from public.workers
			 where company_id = $1
			 order by full_name asc`,
			[companyId]
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Error al obtener trabajadores:', err);
		res.status(500).json({ error: 'Error al obtener trabajadores' });
	}
});

// GET /terminals/:companyId - Obtener terminales de una empresa
app.get('/terminals/:companyId', async (req, res) => {
	try {
		const { companyId } = req.params;

		const result = await pool.query(
			`select id, name, device_uid, location_name, is_active
			 from public.terminals
			 where company_id = $1
			 order by name asc`,
			[companyId]
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Error al obtener terminales:', err);
		res.status(500).json({ error: 'Error al obtener terminales' });
	}
});

// POST /checkins - Registrar fichaje desde terminal (con terminal_id)
app.post('/checkins', async (req, res) => {
	try {
		const { worker_id, event_type, lat, lon, accuracy_m, terminal_id, qr_payload } = req.body;

		if (!worker_id || !event_type) {
			return res.status(400).json({ error: 'worker_id y event_type requeridos' });
		}

		if (REQUIRE_GEO && (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lon, -180, 180))) {
			return res.status(400).json({ error: 'Ubicacion GPS obligatoria y valida (lat/lon)' });
		}

		// Obtener company_id del trabajador
		const workerResult = await pool.query(
			'select company_id from public.workers where id = $1',
			[worker_id]
		);

		if (workerResult.rows.length === 0) {
			return res.status(404).json({ error: 'Trabajador no encontrado' });
		}

		const companyId = workerResult.rows[0].company_id;

		const result = await pool.query(
			`insert into public.attendance_events 
			 (worker_id, company_id, terminal_id, source, event_type, event_at, lat, lon, accuracy_m, qr_payload, tz)
			 values ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10)
			 returning id, worker_id, event_type, event_at, source`,
			[worker_id, companyId, terminal_id || null, 'terminal', event_type, 
			 Number(lat), Number(lon), accuracy_m, qr_payload ? JSON.stringify(qr_payload) : null, 'Europe/Madrid']
		);

		res.status(201).json(result.rows[0]);
	} catch (err) {
		console.error('Error al registrar fichaje:', err);
		res.status(500).json({ error: 'Error al registrar fichaje' });
	}
});

// Error handler
app.use((err, req, res, next) => {
	console.error('Error no manejado:', err);
	res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
	console.log(`🚀 Backend LinClock escuchando en http://localhost:${PORT}`);
	console.log(`📊 Health check: http://localhost:${PORT}/health`);
	console.log(`📍 Geolocalizacion obligatoria: ${REQUIRE_GEO ? 'SI' : 'NO (temporal)'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('SIGTERM recibido, cerrando...');
	pool.end();
	process.exit(0);
});
