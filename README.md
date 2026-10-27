# Postulia

Extensión de Chrome + API propia para **registrar y dar seguimiento a postulaciones laborales**. Guarda una oferta desde LinkedIn, Computrabajo, Indeed y otros portales, y administra todo el proceso en un panel lateral o en un panel de control: estados, recordatorios, notas, etiquetas, estadísticas y exportación.

Postulia es **local-first**: los datos viven en IndexedDB (Dexie) y la v0.1 no envía nada a ningún servidor. La API autoalojada sigue en el repositorio para despliegues propios, pero la extensión no la configura desde la interfaz. No hay servicios de terceros ni telemetría.

> **v0.1** — No incluye postulación automática. Enviar solicitudes de forma masiva incumple los términos de los portales y no es el objetivo del proyecto.

## Características

- **Captura desde la oferta**: botón flotante «Guardar en Postulia» en LinkedIn, Computrabajo, Indeed, Bumeran, Get on Board y Torre. En el resto de portales, el panel lateral inyecta el capturador bajo demanda (permiso `activeTab`) y usa JSON-LD/schema.org o heurísticas genéricas.
- **Descubrimiento de ofertas**: busca desde el panel lateral con filtros de ubicación, modalidad, antigüedad y portal; guarda el historial, crea alertas y guarda ofertas como postulaciones. El filtro de modalidad solo muestra ofertas con modalidad confirmada (las que el portal no indica se pueden incluir aparte). El de ubicación reconoce el país de la ciudad o del nombre indicado (Perú, Colombia, México, Argentina, Chile, España, Uruguay y Ecuador), usa el dominio nacional de cada portal (Computrabajo no tiene portal en España) y descarta las ofertas de otros países; las que no indican ubicación se ocultan salvo que marques «Incluir sin ubicación». LinkedIn se consulta mediante su API pública de empleos; al filtrar por modalidad usa primero una pestaña oculta con la sesión iniciada, porque el endpoint público ignora ese filtro, y recurre a la consulta pública si falla.
- **Alta manual** de cualquier postulación desde el panel de control.
- **Pipeline** con estados: guardada, postulada, en revisión, entrevista, oferta, rechazada y retirada; cada cambio queda en una línea de tiempo.
- **Kanban** con arrastrar y soltar y **vista de lista** con filtros y búsqueda.
- **Recordatorios** de seguimiento con notificaciones del navegador (alarma cada 30 minutos) y recordatorio automático a los 7 días de postular.
- **Detección de duplicados** por URL normalizada (local y contra el servidor), con opción de guardar igualmente.
- **Estadísticas**: embudo, tasa de respuesta, actividad semanal y por portal.
- **Exportación/importación** CSV y JSON, y papelera con restauración.
- **Multiusuario** con JWT, refresh tokens rotativos y sincronización incremental.

## Arquitectura

```
postulia/
├── apps/
│   ├── api/          Fastify 5 + Prisma 6 + PostgreSQL
│   └── extension/    WXT + React 19 + TypeScript + Tailwind 4 + Font Awesome + Dexie
├── packages/
│   └── shared/       Tipos Zod, estados, normalización de URLs y fechas
├── docker/           Dockerfile, compose y Caddy para desplegar con HTTPS
└── package.json      Monorepo con npm workspaces
```

- **Extensión**: el content script no usa Dexie (IndexedDB pertenece al origen de la página). Todo guardado y consulta pasa por mensajes al service worker, que es el único dueño de la base local. El panel lateral y el panel de control comparten los mismos hooks y repositorio.
- **Sincronización**: los IDs se generan en el cliente (UUID). Cada registro tiene `updatedAt` y `deletedAt`; el servidor aplica _last-write-wins_ y el cliente usa un cursor `since` en hora del servidor. Entradas: `POST /api/sync/push` y `GET /api/sync/pull?since=...`.
- **Autenticación**: contraseñas con `scrypt` nativo, access token JWT corto y refresh token rotativo guardado como hash. El refresh token se renueva automáticamente en el cliente.

## Requisitos

- Node.js 20 o superior (probado con Node 24) y npm 10+.
- Chrome 120+ (u otro navegador Chromium con soporte de Side Panel).
- PostgreSQL 15+ para la API (o Docker para el despliegue).

## Desarrollo

```bash
npm install                # instala todos los workspaces
npm run build:shared       # la extensión y la API consumen packages/shared/dist
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
4. Abre el panel de Postulia. No hace falta configurar nada: la extensión arranca en modo local y guarda todo en el navegador.

> La API autoalojada sigue incluida para desarrollo y despliegues propios, pero la v0.1 no expone su configuración en la interfaz.

> Al cargar la extensión sin empaquetar, Chrome le asigna un id. Si quieres restringir CORS a esa extensión, copia el id y usa `CORS_ORIGINS=chrome-extension://<id>`.

### Tests y verificación

```bash
npm test                   # shared (20) + API (7) + extensión (111)
npm run typecheck
npm run build              # shared + API + extensión
```

La API usa un cliente Prisma falso en memoria para las pruebas de integración: no necesitas PostgreSQL para ejecutar `npm test`.

## Uso

- **En un portal compatible**: entra a la oferta y pulsa el botón flotante. Puedes ajustar puesto, empresa, ubicación, estado y notas antes de guardar.
- **En otro portal**: abre el panel lateral de Postulia. Si la página contiene JSON-LD de tipo `JobPosting`, la oferta se detecta y se inyecta el capturador; también puedes guardarla desde el panel.
- **Alta manual**: panel de control → **Nueva postulación**.
- **Panel lateral**: clic en el icono de Postulia. Muestra la oferta activa y los recordatorios próximos.
- **Panel de control**: desde el panel lateral pulsa **Abrir panel completo** (también se abre al instalar la extensión). Incluye resumen, lista, tablero Kanban, recordatorios y ajustes.

### Sincronización

- **Todo es local**: sin cuenta, sin envíos y con los datos en IndexedDB. La interfaz no pide servidor ni sesión.
- La API autoalojada se mantiene en el repositorio para desarrollo y despliegues propios, pero la v0.1 no la configura desde la UI.
- Cuando hay una API configurada en una compilación propia, `syncNow()` sube los cambios pendientes y baja los del servidor.
- Los borrados son blandos (`deletedAt`) para poder restaurarlos desde la papelera.
- Las alertas de búsqueda, los recordatorios y la limpieza del descubrimiento funcionan en local, sin sesión.

## Privacidad

Postulia no incluye telemetría ni analítica y no opera un servidor propio. Ningún dato sale del navegador. Consulta la [política de privacidad](PRIVACY.md) para el detalle de datos, permisos, retención y borrado.

## Despliegue con Docker y HTTPS

El compose incluido levanta PostgreSQL, ejecuta las migraciones, arranca la API y publica todo detrás de Caddy con certificado automático.

1. **DNS**: crea un registro `A` (o `AAAA`) del dominio, por ejemplo `postulia.example.com`, apuntando a la IP del servidor.
2. **Cortafuegos**: abre los puertos 80 y 443. La API y PostgreSQL no se publican al exterior.
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

5. **Primer uso**: en la extensión, configura `https://postulia.example.com`. Crea tu cuenta y luego cambia `ALLOW_REGISTRATION=false` y reinicia la API:

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
- La API aplica rate limit global (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`).
- Caddy añade HSTS y oculta la cabecera `Server`. El tráfico HTTP se redirige a HTTPS.
- Revisa los logs (`docker compose logs api`) y actualiza las imágenes periódicamente.

## API

Todas las rutas (salvo auth y health) requieren `Authorization: Bearer <accessToken>`.

| Método                | Ruta                            | Descripción                               |
| --------------------- | ------------------------------- | ----------------------------------------- |
| GET                   | `/health`                       | Estado del servicio y de la base de datos |
| POST                  | `/api/auth/register`            | Registro (si `ALLOW_REGISTRATION=true`)   |
| POST                  | `/api/auth/login`               | Inicio de sesión                          |
| POST                  | `/api/auth/refresh`             | Rotar el token de actualización           |
| POST                  | `/api/auth/logout`              | Revocar el token de actualización         |
| GET                   | `/api/me`                       | Perfil actual                             |
| GET/POST              | `/api/applications`             | Listar/crear postulaciones                |
| GET/PATCH/DELETE      | `/api/applications/:id`         | Detalle, edición y borrado lógico         |
| GET                   | `/api/applications/lookup?url=` | Comprobar duplicado por URL               |
| GET/POST/PATCH/DELETE | `/api/reminders`                | Recordatorios                             |
| GET/POST/DELETE       | `/api/tags`                     | Etiquetas                                 |
| POST                  | `/api/sync/push`                | Subir cambios locales                     |
| GET                   | `/api/sync/pull?since=`         | Bajar cambios del servidor                |
| GET                   | `/api/stats`                    | Estadísticas del usuario                  |

## Publicación en Chrome Web Store

Consulta [docs/chrome-web-store.md](docs/chrome-web-store.md) para la ficha, la justificación de permisos, las prácticas de privacidad y el checklist de QA. La build de tienda funciona sin servidor; la sincronización con la API es opcional y autoalojada.

## Limitaciones conocidas

- No automatiza el envío de postulaciones.
- La captura automática con botón flotante está garantizada en los seis portales declarados; en otros el panel lateral inyecta el capturador solo tras la invocación del usuario (permiso temporal `activeTab`). Si la página no expone JSON-LD ni metadatos reconocibles, usa el alta manual.
- El descubrimiento depende de la estructura pública de cada portal. Si un portal cambia su HTML, exige iniciar sesión o bloquea peticiones automatizadas, puede devolver un aviso y el resto de portales sigue funcionando. Indeed y Computrabajo pueden responder 403; Bumeran, Get on Board y Torre aún no tienen scraper propio.
- Las migraciones se ejecutan al desplegar; para desarrollo local necesitas una base PostgreSQL accesible.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
