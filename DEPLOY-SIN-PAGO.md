# LinClock sin pagar (guia corta)

## Objetivo

Dejar LinClock funcionando en la nube sin Render y sin tarjeta.

Arquitectura final:

- BD: Supabase PostgreSQL.
- API: Supabase Edge Function (`linclock-api`).
- Frontend: GitHub Pages.

## Paso 1: desplegar API en Supabase

Desde la raiz del repo:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase secrets set \
  SUPABASE_URL=https://TU_PROJECT_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY \
  JWT_SECRET=TU_SECRETO_LARGO \
  CORS_ORIGIN=https://TU_USUARIO.github.io,http://127.0.0.1:5500 \
  REQUIRE_GEO=false
supabase functions deploy linclock-api --no-verify-jwt
```

Prueba de salud:

```bash
curl https://TU_PROJECT_REF.supabase.co/functions/v1/linclock-api/health
```

## Paso 2: enlazar frontend con la API

Edita `js/config.js`:

```js
window.LINCLOCK_API_BASE = 'https://TU_PROJECT_REF.supabase.co/functions/v1/linclock-api';
```

## Paso 3: publicar frontend

1. Sube cambios a GitHub (`git push`).
2. Ve a GitHub -> Settings -> Pages.
3. Source: Deploy from branch.
4. Branch: `main`, folder: `/ (root)`.

La URL de Pages servira:

- Terminal: `/`
- App trabajador: `/worker-app/`

## Produccion estricta GPS

Cuando confirmes que todo funciona por HTTPS, en Supabase:

```bash
supabase secrets set REQUIRE_GEO=true
supabase functions deploy linclock-api --no-verify-jwt
```
