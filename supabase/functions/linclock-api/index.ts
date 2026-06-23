import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.2";
import { SignJWT, jwtVerify } from "npm:jose@5.9.6";

type TokenPayload = {
  workerId: string;
  email: string;
  fullName: string;
  companyId: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";
const jwtSecret = Deno.env.get("JWT_SECRET") || "linclock-dev-secret";
const requireGeo = Deno.env.get("REQUIRE_GEO") !== "false";
const allowedOrigins = (Deno.env.get("CORS_ORIGIN") || "*")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function buildCorsHeaders(origin: string | null) {
  const allowAny = allowedOrigins.includes("*");
  const allowOrigin = allowAny ? "*" : (origin || allowedOrigins[0] || "*");
  const isAllowed = allowAny || (origin ? allowedOrigins.includes(origin) : false);

  return {
    "Access-Control-Allow-Origin": isAllowed ? allowOrigin : (allowedOrigins[0] || "*"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin");
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorResponse(req: Request, message: string, status = 400) {
  return jsonResponse(req, { error: message }, status);
}

function normalizePath(pathname: string) {
  const noTrailing = pathname.replace(/\/+$/, "") || "/";
  if (noTrailing.startsWith("/linclock-api/")) {
    return noTrailing.slice("/linclock-api".length) || "/";
  }
  if (noTrailing === "/linclock-api") {
    return "/";
  }
  return noTrailing;
}

async function parseBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function toNullableNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isValidCoordinate(value: unknown, min: number, max: number) {
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max;
}

async function signWorkerToken(payload: TokenPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(jwtSecret));
}

async function readTokenPayload(req: Request): Promise<TokenPayload | null> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    return {
      workerId: String(payload.workerId || ""),
      email: String(payload.email || ""),
      fullName: String(payload.fullName || ""),
      companyId: String(payload.companyId || ""),
    };
  } catch {
    return null;
  }
}

function mapAttendanceRow(row: Record<string, unknown>) {
  const workers = row.workers as { full_name?: string } | null;
  const companies = row.companies as { name?: string } | null;

  return {
    id: row.id,
    worker_id: row.worker_id,
    worker_name: workers?.full_name || null,
    company_name: companies?.name || null,
    event_type: row.event_type,
    source: row.source,
    event_at: row.event_at,
    lat: row.lat,
    lon: row.lon,
    accuracy_m: row.accuracy_m,
    created_at: row.created_at,
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req.headers.get("origin")) });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(req, "Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY", 500);
  }

  try {
    if (req.method === "GET" && path === "/health") {
      return jsonResponse(req, {
        status: "ok",
        service: "linclock-api",
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === "POST" && path === "/auth/login") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();

      if (!email) {
        return errorResponse(req, "Email requerido", 400);
      }

      const { data, error } = await supabase
        .from("workers")
        .select("id, full_name, email, company_id, is_active, companies(name)")
        .eq("email", email)
        .eq("is_active", true)
        .limit(1);

      if (error) {
        return errorResponse(req, "Error al autenticar", 500);
      }

      if (!data || data.length === 0) {
        return errorResponse(req, "Email no encontrado o trabajador inactivo", 401);
      }

      const worker = data[0] as Record<string, unknown>;
      const companies = worker.companies as { name?: string } | null;

      const token = await signWorkerToken({
        workerId: String(worker.id),
        email: String(worker.email || ""),
        fullName: String(worker.full_name || ""),
        companyId: String(worker.company_id || ""),
      });

      return jsonResponse(req, {
        token,
        worker: {
          id: worker.id,
          full_name: worker.full_name,
          email: worker.email,
          company_id: worker.company_id,
          company_name: companies?.name || null,
        },
      });
    }

    if (path === "/me/profile" || path === "/me/logs" || path === "/me/checkin") {
      const payload = await readTokenPayload(req);
      if (!payload || !payload.workerId) {
        return errorResponse(req, "Token invalido o expirado", 401);
      }

      if (req.method === "GET" && path === "/me/profile") {
        const { data, error } = await supabase
          .from("workers")
          .select("id, full_name, email, dni, company_id, is_active, companies(name)")
          .eq("id", payload.workerId)
          .limit(1);

        if (error) {
          return errorResponse(req, "Error al obtener perfil", 500);
        }

        if (!data || data.length === 0) {
          return errorResponse(req, "Trabajador no encontrado", 404);
        }

        const worker = data[0] as Record<string, unknown>;
        const companies = worker.companies as { name?: string } | null;

        return jsonResponse(req, {
          id: worker.id,
          full_name: worker.full_name,
          email: worker.email,
          dni: worker.dni,
          company_id: worker.company_id,
          company_name: companies?.name || null,
          is_active: worker.is_active,
        });
      }

      if (req.method === "GET" && path === "/me/logs") {
        const limit = Number(url.searchParams.get("limit") || "50");
        const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 5000)) : 50;

        const { data, error } = await supabase
          .from("attendance_events")
          .select("id, worker_id, event_type, event_at, source, lat, lon, accuracy_m, created_at")
          .eq("worker_id", payload.workerId)
          .order("event_at", { ascending: false })
          .limit(safeLimit);

        if (error) {
          return errorResponse(req, "Error al obtener fichajes", 500);
        }

        return jsonResponse(req, data || []);
      }

      if (req.method === "POST" && path === "/me/checkin") {
        const body = await parseBody(req);
        const eventType = String(body.event_type || "");
        const source = String(body.source || "");
        const lat = body.lat;
        const lon = body.lon;
        const accuracy = body.accuracy_m;
        const qrPayload = body.qr_payload ?? null;

        if (!["entrada", "pausa_inicio", "pausa_fin", "salida"].includes(eventType)) {
          return errorResponse(req, "event_type invalido", 400);
        }

        if (!["terminal", "mobile"].includes(source)) {
          return errorResponse(req, "source requerido (terminal|mobile)", 400);
        }

        if (requireGeo && (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lon, -180, 180))) {
          return errorResponse(req, "Ubicacion GPS obligatoria y valida (lat/lon)", 400);
        }

        const { data: workerData, error: workerError } = await supabase
          .from("workers")
          .select("company_id")
          .eq("id", payload.workerId)
          .limit(1);

        if (workerError) {
          return errorResponse(req, "Error al registrar fichaje", 500);
        }

        if (!workerData || workerData.length === 0) {
          return errorResponse(req, "Trabajador no encontrado", 404);
        }

        const companyId = workerData[0].company_id;

        const { data, error } = await supabase
          .from("attendance_events")
          .insert({
            worker_id: payload.workerId,
            company_id: companyId,
            source,
            event_type: eventType,
            event_at: new Date().toISOString(),
            lat: toNullableNumber(lat),
            lon: toNullableNumber(lon),
            accuracy_m: toNullableNumber(accuracy),
            qr_payload: qrPayload,
            tz: "Europe/Madrid",
          })
          .select("id, worker_id, event_type, event_at, source")
          .limit(1);

        if (error) {
          return errorResponse(req, "Error al registrar fichaje", 500);
        }

        return jsonResponse(req, data?.[0] || null, 201);
      }
    }

    if (req.method === "GET" && path === "/companies") {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, cif, is_active")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) {
        return errorResponse(req, "Error al obtener empresas", 500);
      }

      return jsonResponse(req, data || []);
    }

    if (req.method === "GET" && path === "/attendance-events") {
      const companyId = url.searchParams.get("company_id");
      const workerId = url.searchParams.get("worker_id");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const limit = Number(url.searchParams.get("limit") || "2000");
      const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 5000)) : 2000;

      let query = supabase
        .from("attendance_events")
        .select("id, worker_id, company_id, event_type, source, event_at, lat, lon, accuracy_m, created_at, workers(full_name), companies(name)")
        .order("event_at", { ascending: false })
        .limit(safeLimit);

      if (companyId) query = query.eq("company_id", companyId);
      if (workerId) query = query.eq("worker_id", workerId);
      if (from) query = query.gte("event_at", from);
      if (to) query = query.lte("event_at", to);

      const { data, error } = await query;

      if (error) {
        return errorResponse(req, "Error al obtener fichajes", 500);
      }

      return jsonResponse(req, (data || []).map((row) => mapAttendanceRow(row as Record<string, unknown>)));
    }

    if (req.method === "GET" && path === "/workers") {
      const companyId = url.searchParams.get("company_id");

      let query = supabase
        .from("workers")
        .select("id, full_name, dni, email, company_id, is_active, created_at, updated_at, companies(name)")
        .order("full_name", { ascending: true });

      if (companyId) query = query.eq("company_id", companyId);

      const { data, error } = await query;

      if (error) {
        return errorResponse(req, "Error al obtener trabajadores", 500);
      }

      const rows = (data || []).map((row) => {
        const item = row as Record<string, unknown>;
        const companies = item.companies as { name?: string } | null;
        return {
          id: item.id,
          full_name: item.full_name,
          dni: item.dni,
          email: item.email,
          company_id: item.company_id,
          company_name: companies?.name || null,
          is_active: item.is_active,
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      });

      return jsonResponse(req, rows);
    }

    if (req.method === "POST" && path === "/workers") {
      const body = await parseBody(req);
      const companyId = String(body.company_id || "").trim();
      const fullName = String(body.full_name || "").trim();
      const dni = String(body.dni || "").trim().toUpperCase();
      const email = String(body.email || "").trim().toLowerCase();
      const isActive = typeof body.is_active === "boolean" ? body.is_active : true;
      const phone = body.phone ? String(body.phone).trim() : null;
      const employeeCode = body.employee_code ? String(body.employee_code).trim() : null;

      if (!companyId || !fullName || !dni || !email) {
        return errorResponse(req, "company_id, full_name, dni y email son requeridos", 400);
      }

      const { data, error } = await supabase
        .from("workers")
        .insert({
          company_id: companyId,
          full_name: fullName,
          dni,
          email,
          is_active: isActive,
          phone,
          employee_code: employeeCode,
        })
        .select("id, full_name, dni, email, company_id, is_active")
        .limit(1);

      if (error) {
        return errorResponse(req, "Error al crear trabajador", 500);
      }

      return jsonResponse(req, data?.[0] || null, 201);
    }

    if (req.method === "PATCH" && path.startsWith("/workers/")) {
      const workerId = path.slice("/workers/".length).trim();
      if (!workerId) {
        return errorResponse(req, "Trabajador no encontrado", 404);
      }

      const body = await parseBody(req);
      const patch: Record<string, unknown> = {};

      if (typeof body.company_id === "string" && body.company_id.trim()) {
        patch.company_id = body.company_id.trim();
      }
      if (typeof body.full_name === "string" && body.full_name.trim()) {
        patch.full_name = body.full_name.trim();
      }
      if (typeof body.dni === "string" && body.dni.trim()) {
        patch.dni = body.dni.trim().toUpperCase();
      }
      if (typeof body.email === "string" && body.email.trim()) {
        patch.email = body.email.trim().toLowerCase();
      }
      if (typeof body.is_active === "boolean") {
        patch.is_active = body.is_active;
      }
      if (typeof body.phone === "string") {
        patch.phone = body.phone.trim() || null;
      }
      if (typeof body.employee_code === "string") {
        patch.employee_code = body.employee_code.trim() || null;
      }
      patch.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("workers")
        .update(patch)
        .eq("id", workerId)
        .select("id, full_name, dni, email, company_id, is_active")
        .limit(1);

      if (error) {
        return errorResponse(req, "Error al editar trabajador", 500);
      }

      if (!data || data.length === 0) {
        return errorResponse(req, "Trabajador no encontrado", 404);
      }

      return jsonResponse(req, data[0]);
    }

    if (req.method === "GET" && path.startsWith("/workers/")) {
      const companyId = path.slice("/workers/".length).trim();
      if (!companyId) {
        return errorResponse(req, "Error al obtener trabajadores", 400);
      }

      const { data, error } = await supabase
        .from("workers")
        .select("id, full_name, dni, email, company_id, is_active")
        .eq("company_id", companyId)
        .order("full_name", { ascending: true });

      if (error) {
        return errorResponse(req, "Error al obtener trabajadores", 500);
      }

      return jsonResponse(req, data || []);
    }

    if (req.method === "GET" && path.startsWith("/terminals/")) {
      const companyId = path.slice("/terminals/".length).trim();
      if (!companyId) {
        return errorResponse(req, "Error al obtener terminales", 400);
      }

      const { data, error } = await supabase
        .from("terminals")
        .select("id, name, device_uid, location_name, is_active")
        .eq("company_id", companyId)
        .order("name", { ascending: true });

      if (error) {
        return errorResponse(req, "Error al obtener terminales", 500);
      }

      return jsonResponse(req, data || []);
    }

    if (req.method === "POST" && path === "/checkins") {
      const body = await parseBody(req);
      const workerId = String(body.worker_id || "").trim();
      const eventType = String(body.event_type || "").trim();
      const lat = body.lat;
      const lon = body.lon;
      const accuracy = body.accuracy_m;
      const terminalId = body.terminal_id ? String(body.terminal_id).trim() : null;
      const qrPayload = body.qr_payload ?? null;

      if (!workerId || !eventType) {
        return errorResponse(req, "worker_id y event_type requeridos", 400);
      }

      if (requireGeo && (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lon, -180, 180))) {
        return errorResponse(req, "Ubicacion GPS obligatoria y valida (lat/lon)", 400);
      }

      const { data: workerData, error: workerError } = await supabase
        .from("workers")
        .select("company_id")
        .eq("id", workerId)
        .limit(1);

      if (workerError) {
        return errorResponse(req, "Error al registrar fichaje", 500);
      }

      if (!workerData || workerData.length === 0) {
        return errorResponse(req, "Trabajador no encontrado", 404);
      }

      const companyId = workerData[0].company_id;

      const { data, error } = await supabase
        .from("attendance_events")
        .insert({
          worker_id: workerId,
          company_id: companyId,
          terminal_id: terminalId,
          source: "terminal",
          event_type: eventType,
          event_at: new Date().toISOString(),
          lat: toNullableNumber(lat),
          lon: toNullableNumber(lon),
          accuracy_m: toNullableNumber(accuracy),
          qr_payload: qrPayload,
          tz: "Europe/Madrid",
        })
        .select("id, worker_id, event_type, event_at, source")
        .limit(1);

      if (error) {
        return errorResponse(req, "Error al registrar fichaje", 500);
      }

      return jsonResponse(req, data?.[0] || null, 201);
    }

    return errorResponse(req, "Ruta no encontrada", 404);
  } catch (err) {
    console.error("Error no manejado:", err);
    return errorResponse(req, "Error interno del servidor", 500);
  }
});
