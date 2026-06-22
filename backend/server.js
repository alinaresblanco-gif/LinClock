import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu-clave-secreta-super-segura';

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

// Health check
app.get('/health', (req, res) => {
	res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
			[req.workerId, companyId, source, event_type, lat, lon, accuracy_m, 
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
			 lat, lon, accuracy_m, qr_payload ? JSON.stringify(qr_payload) : null, 'Europe/Madrid']
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
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('SIGTERM recibido, cerrando...');
	pool.end();
	process.exit(0);
});
