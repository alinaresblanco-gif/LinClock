# LinClock API en Supabase Edge Functions

Esta funcion reemplaza el backend de Node/Render para usar solo plan gratuito de Supabase.

## Requisitos

- Tener instalado Supabase CLI.
- Estar autenticado: `supabase login`.
- Vincular proyecto: `supabase link --project-ref TU_PROJECT_REF`.

## Variables de entorno requeridas

Configuralas como secretos de funciones:

```bash
supabase secrets set \
  SUPABASE_URL=https://TU_PROJECT_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY \
  JWT_SECRET=TU_SECRETO_LARGO \
  CORS_ORIGIN=https://TU_USUARIO.github.io,http://127.0.0.1:5500 \
  REQUIRE_GEO=false
```

## Desplegar

```bash
supabase functions deploy linclock-api --no-verify-jwt
```

URL base final:

```text
https://TU_PROJECT_REF.supabase.co/functions/v1/linclock-api
```

## Probar rapido

```bash
curl https://TU_PROJECT_REF.supabase.co/functions/v1/linclock-api/health
```

Respuesta esperada:

```json
{"status":"ok","service":"linclock-api"}
```
