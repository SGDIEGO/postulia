# Postulia

Extensión de Chrome + API propia para **registrar y dar seguimiento a postulaciones laborales**. Guarda una oferta desde LinkedIn, Computrabajo, Indeed y otros portales, y administra todo el proceso en un panel lateral o en un dashboard: estados, recordatorios, notas, etiquetas, estadísticas y exportación.

Postulia es **local-first**: los datos viven en IndexedDB (Dexie) y se sincronizan con tu servidor cuando hay conexión. No hay servicios de terceros ni telemetría.

> **v0.1** — No incluye postulación automática. Enviar solicitudes de forma masiva incumple los términos de los portales y no es el objetivo del proyecto.

## Características

- **Captura desde la oferta**: botón flotante «Guardar en Postulia» en LinkedIn, Computrabajo, Indeed, Bumeran, Get on Board y Torre. En el resto de portales, el panel lateral inyecta el capturador bajo demanda (permiso `activeTab`) y usa JSON-LD/schema.org o heurísticas genéricas.
- **Descubrimiento de ofertas**: busca desde el panel lateral con filtros de ubicación, modalidad, antigüedad y portal; guarda el historial, crea alertas y guarda ofertas como postulaciones. LinkedIn se consulta en una pestaña oculta temporal mediante los permisos de host de los seis portales.
- **Alta manual** de cualquier postulación desde el dashboard.
- **Pipeline** con estados: guardada, postulada, en revisión, entrevista, prueba técnica, oferta, rechazada, retirada; cada cambio queda en una línea de tiempo.
- **Kanban** con arrastrar y soltar y **vista de lista** con filtros y búsqueda.
- **Recordatorios** de seguimiento con notificaciones del navegador (alarma cada 30 minutos) y recordatorio automático configurable tras postular.
- **Detección de duplicados** por URL normalizada (local y contra el servidor), con opción de guardar igualmente.
- **Estadísticas**: embudo, tasa de respuesta, actividad por mes y portal.
- **Exportación/importación** CSV y JSON, y papelera con restauración.
- **Multiusuario** con JWT, refresh tokens rotativos y sincronización incremental.

## Arquitectura

```
postulia/
├── apps/
│   ├── api/          Fastify 5 + Prisma 6 + PostgreSQL
│   └── extension/    WXT + React 19 + TypeScript + Tailwind 4 + Dexie
├── packages/
│   └── shared/       Tipos Zod, estados, normalización de URLs y fechas
├── docker/           Dockerfile, compose y Caddy para desplegar con HTTPS
└── package.json      Monorepo con npm workspaces
```

- **Extensión**: el content script no usa Dexie (IndexedDB pertenece al origen de la página). Todo guardado y consulta pasa por mensajes al service worker, que es el único dueño de la base local. El panel lateral y el dashboard comparten los mismos hooks y repositorio.
- **Sincronización**: los IDs se generan en el cliente (UUID). Cada registro tiene `updatedAt` y `deletedAt`; el servidor aplica _last-write-wins_ y el cliente usa un cursor `since` en hora del servidor. Entradas: `POST /api/sync/push` y `GET /api/sync/pull?since=...`.
- **Autenticación**: contraseñas con `scrypt` nativo, access token JWT corto y refresh token rotativo guardado como hash. El refresh se renueva solo en el cliente.

## Requisitos

- Node.js 20 o superior (probado con Node 24) y npm 10+.
- Chrome 120+ (u otro navegador Chromium con soporte de Side Panel).
- PostgreSQL 15+ para el API (o Docker para el despliegue).

## Desarrollo

```bash
npm install                # instala todos los workspaces
npm run build:shared       # la extensión y el API consumen packages/shared/dist
```

### API

```bash
cp apps/api/.env.example apps/api/.env
# edita DATABASE_URL y JWT_SECRET
npx prisma migrate dev --schema apps/api/prisma/schema.prisma
npm run dev:api            # http://localhost:3000
```

Comprobación rápida: `curl http://localhost:3000/health`.

### Extensión

```bash
npm run dev:ext            # recarga automática en .output/chrome-mv3-dev
# o
npm run build -w @postulia/extension
```

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. **Cargar descomprimida** y elige `apps/extension/.output/chrome-mv3` (o `chrome-mv3-dev` en modo dev).
4. Abre **Ajustes** de Postulia, escribe la URL del API (`http://localhost:3000` o tu dominio) y pulsa **Guardar y probar**. Chrome pedirá permiso para ese origen; es necesario porque el API no está declarado como host fijo.
5. Registra una cuenta o inicia sesión. Si usas el despliegue Docker, crea tu cuenta y después pon `ALLOW_REGISTRATION=false`.

> Al cargar la extensión sin empaquetar, Chrome le asigna un id. Si quieres restringir CORS a esa extensión, copia el id y usa `CORS_ORIGINS=chrome-extension://<id>`.

### Tests y verificación

```bash
npm test                   # shared (7) + API (7) + extractores (6)
npm run typecheck
npm run build              # shared + API + extensión
```

El API usa un cliente Prisma falso en memoria para las pruebas de integración: no necesitas PostgreSQL para ejecutar `npm test`.

## Uso

- **En un portal compatible**: entra a la oferta y pulsa el botón flotante. Puedes ajustar puesto, empresa, ubicación, estado y notas antes de guardar.
- **En otro portal**: abre el panel lateral de Postulia. Si la página contiene JSON-LD de tipo `JobPosting`, la oferta se detecta y se inyecta el capturador; también puedes guardarla desde el panel.
- **Alta manual**: dashboard → **Nueva postulación**.
- **Panel lateral**: clic en el icono de Postulia. Muestra la oferta activa, recordatorios próximos y el estado de sincronización.
- **Dashboard**: desde el panel lateral pulsa **Abrir Postulia** (también se abre al instalar la extensión). Incluye resumen, lista, kanban, recordatorios y ajustes.

### Sincronización

- Sin sesión, todo funciona en local.
- Al iniciar sesión, `syncNow()` sube los cambios pendientes y baja los del servidor.
- Alarma cada 15 minutos (configurable en Ajustes) y sincronización manual desde el icono.
- Los borrados son blandos (`deletedAt`) para propagarse entre dispositivos.

## Despliegue con Docker y HTTPS

El compose incluido levanta PostgreSQL, ejecuta las migraciones, arranca el API y publica todo detrás de Caddy con certificado automático.

1. **DNS**: crea un registro `A` (o `AAAA`) del dominio, por ejemplo `postulia.example.com`, apuntando a la IP del servidor.
2. **Cortafuegos**: abre los puertos 80 y 443. El API y PostgreSQL no se publican al exterior.
3. **Configuración**:

   ```bash
   cd docker
   cp .env.example .env
   # DOMAIN, POSTGRES_PASSWORD y JWT_SECRET son obligatorios
   openssl rand -base64 48   # pega el resultado en JWT_SECRET
   ```

4. **Arranque** (desde `docker/`):

   ```bash
   docker compose up -d --build
   docker compose logs -f caddy api
   ```

5. **Primer uso**: en la extensión, configura `https://postulia.example.com`. Crea tu cuenta y luego cambia `ALLOW_REGISTRATION=false` y reinicia el API:

   ```bash
   docker compose up -d api
   ```

6. **Actualizaciones**:

   ```bash
   git pull
   docker compose up -d --build
   ```

### Copias de seguridad

```bash
docker compose exec db pg_dump -U postulia postulia > postulia-$(date +%F).sql
```

Restauración:

```bash
cat postulia-2026-10-20.sql | docker compose exec -T db psql -U postulia -d postulia
```

### Notas de seguridad

- Usa un `JWT_SECRET` largo y único; si cambia, todas las sesiones se invalidan.
- Mantén `ALLOW_REGISTRATION=false` cuando ya tengas tus cuentas.
- El API aplica rate limit global (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`).
- Caddy añade HSTS y oculta la cabecera `Server`. El tráfico HTTP se redirige a HTTPS.
- Revisa los logs (`docker compose logs api`) y actualiza las imágenes periódicamente.

## API

Todas las rutas (salvo auth y health) requieren `Authorization: Bearer <accessToken>`.

| Método                | Ruta                            | Descripción                               |
| --------------------- | ------------------------------- | ----------------------------------------- |
| GET                   | `/health`                       | Estado del servicio y de la base de datos |
| POST                  | `/api/auth/register`            | Registro (si `ALLOW_REGISTRATION=true`)   |
| POST                  | `/api/auth/login`               | Login                                     |
| POST                  | `/api/auth/refresh`             | Rotar refresh token                       |
| POST                  | `/api/auth/logout`              | Revocar refresh token                     |
| GET                   | `/api/me`                       | Perfil actual                             |
| GET/POST              | `/api/applications`             | Listar/crear postulaciones                |
| GET/PATCH/DELETE      | `/api/applications/:id`         | Detalle, edición y borrado lógico         |
| GET                   | `/api/applications/lookup?url=` | Comprobar duplicado por URL               |
| GET/POST/PATCH/DELETE | `/api/reminders`                | Recordatorios                             |
| GET/POST/DELETE       | `/api/tags`                     | Etiquetas                                 |
| POST                  | `/api/sync/push`                | Subir cambios locales                     |
| GET                   | `/api/sync/pull?since=`         | Bajar cambios del servidor                |
| GET                   | `/api/stats`                    | Estadísticas del usuario                  |

## Limitaciones conocidas

- No automatiza el envío de postulaciones.
- La captura automática con botón flotante está garantizada en los seis portales declarados; en otros el panel lateral inyecta el capturador solo tras la invocación del usuario (permiso temporal `activeTab`). Si la página no expone JSON-LD ni metadatos reconocibles, usa el alta manual.
- El descubrimiento depende de la estructura pública de cada portal. Si un portal cambia su HTML, exige iniciar sesión o bloquea peticiones automatizadas, puede devolver un aviso y el resto de portales sigue funcionando. Indeed y Computrabajo pueden responder 403; Bumeran, Get on Board y Torre aún no tienen scraper propio.
- Las migraciones se ejecutan al desplegar; para desarrollo local necesitas una base PostgreSQL accesible.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
