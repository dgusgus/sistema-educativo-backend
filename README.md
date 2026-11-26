# Backend — Sistema de gestión académica

API REST de la **Unidad Educativa «Los Ángeles de Nazaria Ignacia»** (Oruro, Bolivia). Gestiona estudiantes, docentes, tutores, cursos, asistencia, calificaciones por trimestre, boletines, pagos y cobranza, historial académico y promoción de gestión.

Proyecto de grado de Ingeniería de Sistemas, Universidad Técnica de Oruro (UTO).

El frontend vive en su propio repositorio (`front_end_educa`, Vue 3). Este documento cubre solo el backend.

---

## Tecnologías

| Capa | Herramienta |
|---|---|
| Servidor | Node.js 22 · Express 5 · TypeScript |
| Base de datos | PostgreSQL 16 |
| ORM | Prisma 7 (`@prisma/adapter-pg`) |
| Validación | Zod 4 |
| Seguridad | JWT · bcryptjs · helmet · cors · express-rate-limit |
| Archivos | exceljs (importar/exportar Excel) · pdfkit (boletines y recibos) |
| Logs | pino / pino-http |
| Pruebas | Vitest · Supertest |

## Requisitos

- Node.js 22 o superior
- pnpm (`npm i -g pnpm`)
- PostgreSQL 16, o Docker para levantarlo con el `docker-compose.yml` incluido

## Puesta en marcha

```bash
# 1. Dependencias
pnpm install

# 2. Variables de entorno
cp .env.example .env
#    Edita .env: DATABASE_URL, POSTGRES_PASSWORD (la misma clave en ambos) y JWT_SECRET

# 3. Base de datos (opción Docker)
docker compose up -d

# 4. Tablas
pnpm db:migrate          # aplica las migraciones y genera el cliente de Prisma

# 5. Datos de prueba (elige un perfil; ver «Semillas»)
pnpm db:seed:perfil demo --limpiar

# 6. Servidor en modo desarrollo (recarga al guardar)
pnpm dev
```

La API queda en `http://localhost:4000/api`. Comprueba que responde:

```bash
curl http://localhost:4000/api/health      # { "status": "ok", ... }
curl http://localhost:4000/api/ready       # comprueba también la conexión a PostgreSQL
```

> **JWT_SECRET** debe tener 32 caracteres o más. Genera uno con:
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Variables de entorno

Todas están documentadas en `.env.example`. Las principales:

| Variable | Para qué sirve |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `POSTGRES_PASSWORD` | Clave del contenedor de Docker (debe coincidir con la de `DATABASE_URL`) |
| `JWT_SECRET` | Firma de los tokens (mínimo 32 caracteres) |
| `JWT_EXPIRES_IN` | Duración de la sesión (por defecto `8h`) |
| `PORT` | Puerto del servidor (por defecto `4000`) |
| `FRONTEND_URL` | Origen(es) permitidos por CORS, separados por coma |
| `NODE_ENV` | `development` o `production` |
| `LOG_LEVEL` | `fatal` · `error` · `warn` · `info` · `debug` · `trace` · `silent` |
| `TRUST_PROXY` | Cantidad de proxies delante (nginx, Render, Railway). Omitir si no hay |
| `RATE_LIMIT_API` | Peticiones por IP cada 15 min (300 por defecto) |
| `RATE_LIMIT_LOGIN` | Intentos de login por IP cada 15 min (15 por defecto) |

Un colegio entero suele salir por una sola IP: si hay muchos usuarios simultáneos y aparece el error 429, sube estos dos límites.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor con recarga automática |
| `pnpm dev:pretty` | Igual, con logs legibles |
| `pnpm build` | Compila TypeScript a `dist/` |
| `pnpm start` | Ejecuta la versión compilada (`dist/server.js`) |
| `pnpm typecheck` | Revisa tipos sin compilar |
| `pnpm test` | Ejecuta todas las pruebas |
| `pnpm test:watch` | Pruebas en modo vigilancia |
| `pnpm db:migrate` | Crea/aplica migraciones en desarrollo |
| `pnpm db:push` | Sincroniza el esquema sin crear migración (solo experimentos) |
| `pnpm db:generate` | Regenera el cliente de Prisma |
| `pnpm db:studio` | Explorador visual de la base de datos |
| `pnpm db:seed` | Semilla clásica («defensa», `prisma/seed.ts`) |
| `pnpm db:seed:perfil <perfil> [--limpiar]` | Lanzador de perfiles de semilla |
| `pnpm db:seed:prod` | Crea solo el director inicial de un servidor real |

## Semillas (datos de prueba)

Todas son **deterministas**: sin `Math.random`, así que los mismos nombres, CIs y casos aparecen en cada carga.

```bash
pnpm db:seed:perfil <perfil> --limpiar
```

`--limpiar` vacía las tablas de datos antes de sembrar (conserva las migraciones). Sin esa bandera, el lanzador se niega a sembrar sobre una base que ya tiene datos. Solo funciona en bases locales, salvo `SEED_FORZAR=si`.

| Perfil | Contenido | Úsalo para |
|---|---|---|
| **`demo`** | 500 inscritos, 18 cursos, 3 gestiones (2 cerradas), nombres y CIs realistas, cobranza con mora | **La defensa de tesis** |
| `historico` | 900 inscritos + 2 gestiones cerradas | Historial y comparativo entre gestiones |
| `carga` | 900 inscritos, horarios, notas, asistencia, pagos | Prueba de carga |
| `volumen` | ~900 estudiantes | Paginación, búsqueda, rendimiento |
| `promocion` | Fin de año con un caso de cada rama | Promoción de gestión |
| `estructura` | Colegio armado, sin estudiantes | Inscribir o importar desde cero |
| `importacion` | 24 cursos sin personas | Probar los Excel de `generar-excel.ts` |
| `mini` | 3 docentes, 3 cursos × 2 estudiantes, 3 gestiones | Pruebas rápidas |
| `vacio` | Solo catálogo y director | Arranque desde cero |
| `defensa` / `cierre` | Semilla clásica (`prisma/seed.ts`); `cierre` deja el T3 al 100 % | Cerrar la gestión desde el sistema |

### Credenciales de desarrollo

Una sola convención para todas las semillas:

| Rol | Usuario | Contraseña |
|---|---|---|
| Director | `director` | `admin1234` |
| Secretaria | `secretaria` | `sec1234` |
| Docentes | `doc01`, `doc02`… | `doc1234` |
| Estudiantes | `est_v001`, `est_v002`… | `est1234` |
| Tutores | `tut_v001`, `tut_v002`… | `tut1234` |

El perfil `demo` llega hasta `doc37`, `est_v060` y `tut_v030`. Según el perfil pueden faltar cuentas (por ejemplo, `vacio` solo trae `director`).

> Solo para desarrollo. Nunca uses estas claves en un servidor real.

### Variables opcionales de las semillas

`SEED_ANCLA=AAAA-MM-DD` fija el «hoy» de la simulación · `SEED_PASSWORD_DEMO=` una sola clave para todas las cuentas (demo público) · `SEED_T3_COMPLETO=si` · `SEED_FORZAR=si`. Detalle en `.env.example`.

## Estructura

```
src/
├── server.ts            Arranque y cierre ordenado
├── app.ts               Middlewares, rutas públicas y montaje de /api/*
├── routes/              Una por módulo: rutas + roles permitidos + validación
├── controllers/         Reciben la petición y responden (delgados)
├── services/            Lógica de negocio compleja (cierre, promoción, cobranza…)
├── schemas/             Esquemas Zod de entrada
├── middlewares/         auth · rbac · validate · límites · subida de archivos · errores
├── lib/                 Reglas puras y utilidades (cálculo de notas, asistencia, paginación…)
└── shared/ · types/
prisma/
├── schema.prisma        30 modelos, 14 enums
├── migrations/
├── seed.ts              Semilla clásica
├── seeds/               Perfiles de semilla (demo, carga, mini…)
└── seed.produccion.ts   Solo el director inicial
tests/                   Unitarias e integración
```

Las reglas importantes (cálculo de notas, fechas de asistencia, cobranza, paginación) están en `src/lib/` como funciones puras, sin Prisma, para probarlas sin base de datos.

## API

Prefijo `/api`. Todo requiere token (`Authorization: Bearer <token>`) salvo `/health`, `/ready`, `/auth/login` y los datos públicos de la institución para la pantalla de login.

| Ruta | Módulo |
|---|---|
| `/auth` | Login, perfil (`/me`), cambio de contraseña |
| `/usuarios` | Cuentas y roles |
| `/estudiantes` · `/tutores` · `/docentes` · `/directores` · `/secretarias` | Personas por rol |
| `/inscripciones` | Inscripción por gestión y curso |
| `/gestiones` · `/trimestres` · `/cursos` · `/materias` · `/horarios` | Estructura académica |
| `/asistencia` | Registro diario y resumen |
| `/calificaciones` · `/actividades` | Notas por dimensión y trimestre |
| `/boletin` | Boletines y libretas (PDF) |
| `/pagos` | Conceptos, cobros, recibos, cobranza |
| `/historial` | Trayectoria por estudiante |
| `/cuaderno` | Cuaderno pedagógico |
| `/institucion` | Datos del colegio |

El archivo `REST Client/login.http` trae ejemplos para probar con la extensión REST Client de VS Code.

### Roles

`DIRECTOR` · `SECRETARIA` · `DOCENTE` · `ESTUDIANTE` · `TUTOR`. Un usuario puede tener varios. Los permisos se validan **en el servidor** (`requireRol`) y, además, cada recurso comprueba pertenencia: un estudiante o tutor solo ve sus propios datos.

### Convenciones

- **Paginación opcional.** Con `?pagina=1&limite=25` la respuesta es `{ data, meta: { pagina, limite, total, totalPaginas } }`. Sin `?pagina` devuelve el arreglo completo. Disponible en `/estudiantes` y `/tutores`.
- **Errores.** Se lanzan `ErrorDeUsuario` (400), `NoEncontrado` (404), `Prohibido` (403) o `Conflicto` (409) y el middleware central los convierte en `{ error: "mensaje" }`.
- **Validación.** Cada entrada pasa por un esquema Zod antes de llegar al controlador.
- **Trimestres cerrados son de solo lectura:** no se registra asistencia ni se cambian notas.
- **CI.** El servidor acepta de 3 a 20 caracteres alfanuméricos (hay extranjeros y documentos antiguos). El frontend avisa, sin bloquear, si no parece un CI boliviano (7 dígitos + complemento opcional).

## Pruebas

```bash
pnpm test
```

Las pruebas unitarias no necesitan base de datos. Para ejecutar también las de **integración** (contra PostgreSQL real) crea una base aparte y define:

```bash
TEST_DATABASE_URL="postgresql://postgres:CLAVE@localhost:5432/educa_test?schema=public" pnpm test
```

> Las pruebas de integración **vacían las tablas** de esa base. Usa una exclusiva para pruebas, nunca la de desarrollo.

La base de pruebas necesita el esquema aplicado antes (`DATABASE_URL=<la de pruebas> pnpm prisma migrate deploy`).

## Despliegue en un servidor real

1. Define las variables de producción: `NODE_ENV=production`, `DATABASE_URL`, un `JWT_SECRET` propio y largo, `FRONTEND_URL` con el dominio real y `TRUST_PROXY` si hay proxy.
2. Instala, compila y aplica las migraciones:
   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   pnpm prisma migrate deploy
   ```
3. Crea el director inicial **sin** usar las semillas de demostración:
   ```bash
   SEED_ADMIN_USERNAME=director SEED_ADMIN_PASSWORD='<12 a 72 caracteres>' \
   SEED_ADMIN_CI=... SEED_ADMIN_NOMBRE=... SEED_ADMIN_APELLIDO=... pnpm db:seed:prod
   ```
4. Arranca con `pnpm start` y usa `/api/health` y `/api/ready` para los chequeos del hosting.

Las semillas de demostración se niegan a correr con `NODE_ENV=production`.

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `Can't reach database server` | PostgreSQL no está levantado. Con Docker: `docker compose up -d` |
| `password authentication failed` | La clave de `DATABASE_URL` no coincide con `POSTGRES_PASSWORD`. Si el volumen ya existía, la clave anterior sigue vigente |
| Error 429 «Demasiados intentos» | Límite por IP. Sube `RATE_LIMIT_API` / `RATE_LIMIT_LOGIN` o espera unos minutos |
| `El lanzador se niega a sembrar` | La base ya tiene datos. Repite el comando con `--limpiar` |
| Falla `prisma migrate` descargando el motor | Red restringida. Aplica los `migration.sql` con `psql -f` en orden |
| Cambió `schema.prisma` y faltan tipos | `pnpm db:generate` |

## Seguridad

- El archivo `.env` **no debe subirse** al repositorio ni compartirse (ya está en `.gitignore`). Si alguna vez se compartió, cambia `JWT_SECRET` y las claves de la base.
- Contraseñas con bcrypt; bloqueo temporal tras intentos fallidos de login.
- helmet, CORS restringido a `FRONTEND_URL` y límites de peticiones por IP.
