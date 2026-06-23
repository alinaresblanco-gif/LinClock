# Backend LinClock

API REST para LinClock - Terminal de fichaje y App de Trabajadores.

## Instalación

1. **Instala Node.js** (v16 o superior):
   - Descarga desde https://nodejs.org/
   - Verifica: `node --version` y `npm --version`

2. **Instala dependencias**:
```bash
npm install
```

3. **Configura variables de entorno**:
   - Copia `.env.example` a `.env`
   - Edita `.env` con tus valores reales

### Variables requeridas:

- `DATABASE_URL`: Conexión a Supabase
  - Obtén en: Supabase → Settings → Database → Connection string (PostgreSQL)
  - Reemplaza `[YOUR-PASSWORD]` con tu contraseña DB
  - Ejemplo: `postgresql://postgres:xxxxx@xxxxx.supabase.co:5432/postgres`

- `JWT_SECRET`: Clave para firmar tokens (mínimo 32 caracteres aleatorios)
  - Genera: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Ejemplo: `abc123def456ghi789jkl012mno345pqr`

- `PORT`: Puerto donde escucha el servidor (default: 3000)

- `CORS_ORIGIN`: URLs permitidas para peticiones (separadas por comas)
  - Ejemplo: `http://localhost:3000,http://192.168.1.150:3000,https://tu-dominio.com`

## Ejecutar

### Desarrollo (con auto-reload):
```bash
npm run dev
```

### Producción:
```bash
npm start
```

El servidor escuchará en `http://localhost:3000`

## Despliegue Cloud (Render)

El repositorio ya incluye `render.yaml` en la raiz para despliegue one-click.

Pasos:

1. Entra en Render y conecta tu cuenta de GitHub.
2. Crea un servicio usando `Blueprint` sobre este repo.
3. Render detectara `render.yaml` y levantara `linclock-backend`.
4. Configura estas variables en Render:
  - `DATABASE_URL`: usa Supabase Transaction Pooler.
  - `JWT_SECRET`: clave fuerte aleatoria.
  - `CORS_ORIGIN`: dominios permitidos separados por comas.
5. Para produccion, deja `REQUIRE_GEO=true`.

Notas:

- El backend sirve tambien el frontend del terminal (`/`) y app trabajador (`/worker-app/`).
- Cuando despliegues en cloud, usa la URL de Render para acceder desde movil/tablet.
- `backend/.env` no debe subirse nunca al repo.

## Endpoints

### Auth

#### POST `/auth/login`
Login sin contraseña (solo email)

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carlos@empresa.com"}'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "worker": {
    "id": "uuid",
    "full_name": "Carlos Mena",
    "email": "carlos@empresa.com",
    "company_id": "uuid",
    "company_name": "Rivimetal"
  }
}
```

### Trabajador (requieren JWT token en header: `Authorization: Bearer <token>`)

#### GET `/me/profile`
Obtener perfil del trabajador autenticado

```bash
curl http://localhost:3000/me/profile \
  -H "Authorization: Bearer TOKEN"
```

#### GET `/me/logs`
Obtener fichajes personales

```bash
curl "http://localhost:3000/me/logs?limit=50" \
  -H "Authorization: Bearer TOKEN"
```

#### POST `/me/checkin`
Registrar un fichaje

```bash
curl -X POST http://localhost:3000/me/checkin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "event_type": "entrada",
    "source": "mobile",
    "lat": 40.4168,
    "lon": -3.7038,
    "accuracy_m": 5.5
  }'
```

Event types: `entrada`, `pausa_inicio`, `pausa_fin`, `salida`
Source: `mobile` o `terminal`

### Terminal (públicos)

#### GET `/workers/:companyId`
Obtener trabajadores de una empresa

```bash
curl "http://localhost:3000/workers/COMPANY-UUID"
```

#### GET `/terminals/:companyId`
Obtener terminales de una empresa

```bash
curl "http://localhost:3000/terminals/COMPANY-UUID"
```

#### POST `/checkins`
Registrar fichaje desde terminal

```bash
curl -X POST http://localhost:3000/checkins \
  -H "Content-Type: application/json" \
  -d '{
    "worker_id": "WORKER-UUID",
    "event_type": "entrada",
    "terminal_id": "TERMINAL-UUID",
    "lat": 40.4168,
    "lon": -3.7038,
    "accuracy_m": 5.5
  }'
```

## Conexión desde las Apps

### App Trabajador (worker-app/js/app.js)

1. Login:
```javascript
const response = await fetch('http://localhost:3000/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: userEmail })
});
const { token } = await response.json();
localStorage.setItem('authToken', token);
```

2. Obtener fichajes:
```javascript
const response = await fetch('http://localhost:3000/me/logs', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const logs = await response.json();
```

3. Registrar fichaje:
```javascript
const response = await fetch('http://localhost:3000/me/checkin', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    event_type: 'entrada',
    source: 'mobile',
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy_m: position.coords.accuracy
  })
});
```

## Troubleshooting

### Error: "Cannot find module"
```bash
npm install
```

### Error: "DATABASE_URL not found"
- Verifica que `.env` existe
- Verifica que DATABASE_URL tiene valor correcto
- Reinicia el servidor

### Error: "Token invalid"
- Verifica JWT_SECRET es el mismo en `.env`
- Verifica que el token no ha expirado (30 días)

### Error CORS
- Verifica CORS_ORIGIN en `.env` incluye tu dominio
- Para desarrollo local: `http://localhost:3000,http://192.168.1.150:3000`

## Notas de seguridad

- Nunca commitees `.env` a git (usa `.env.example`)
- JWT_SECRET debe ser único y fuerte
- En producción, siempre usa HTTPS
- Configura CORS_ORIGIN solo para dominios confiables
- Considera agregar rate limiting para endpoints de login
