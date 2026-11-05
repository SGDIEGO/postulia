# Estructura del proyecto y flujo de Postulia

Este documento explica cómo está organizado Postulia y, especialmente, cómo
se obtiene un post de LinkedIn para generar y enviar un correo con IA.

## 1. Visión general

Postulia es un monorepo de npm con tres piezas principales:

```text
postulia/
├── apps/
│   ├── extension/     Extensión de Chrome: UI, captura y almacenamiento local
│   └── api/           Backend Fastify: autenticación, CV, IA, SMTP y sincronización
├── packages/
│   └── shared/        Tipos, esquemas y utilidades compartidos
├── docker/            Despliegue con PostgreSQL, API y Caddy/HTTPS
├── docs/              Documentación del proyecto
├── README.md          Instalación, uso y comandos generales
└── package.json       Configuración del monorepo y workspaces
```

El `package.json` raíz declara como workspaces `packages/*` y `apps/*`.
Por eso los paquetes pueden importarse entre sí, por ejemplo:

```ts
import type { ApplicationRecord } from "@postulia/shared";
```

## 2. Aplicación de extensión

La extensión está en [`apps/extension/`](../apps/extension/). Usa:

- WXT para compilar la extensión Manifest V3.
- React para las interfaces.
- TypeScript.
- Dexie sobre IndexedDB para datos locales.
- Tailwind CSS para estilos.
- APIs de Chrome mediante `wxt/browser`.

### 2.1 Entrypoints

Un entrypoint es un punto de entrada que Chrome ejecuta en un contexto
distinto.

#### `background.ts`

[`background.ts`](../apps/extension/entrypoints/background.ts) es el service
worker de la extensión. Coordina operaciones que no deben depender de una
ventana visible:

- Recibe mensajes del panel y del content script.
- Guarda postulaciones en IndexedDB mediante el repositorio.
- Comprueba duplicados.
- Cambia estados.
- Ejecuta sincronizaciones.
- Programa alarmas de recordatorios y alertas.
- Abre el dashboard.
- Procesa el mensaje de envío de correo definido para el background.

El listener principal es `browser.runtime.onMessage`. Los mensajes se
identifican por `type`, por ejemplo `postulia:capture` o
`postulia:save-linkedin-post`.

#### `content/index.tsx`

[`content/index.tsx`](../apps/extension/entrypoints/content/index.tsx) se
inyecta en LinkedIn y otros portales compatibles. Su responsabilidad es leer
el DOM de la página actual y responder mensajes:

```text
postulia:extract
    -> extrae una oferta laboral

postulia:ping
    -> comprueba que el content script esté activo
```

También monta el botón flotante `Guardar en Postulia` usando
[`CaptureWidget.tsx`](../apps/extension/entrypoints/content/CaptureWidget.tsx).

#### `sidepanel/main.tsx` y `sidepanel/App.tsx`

[`sidepanel/main.tsx`](../apps/extension/entrypoints/sidepanel/main.tsx)
monta React en el panel lateral.

[`sidepanel/App.tsx`](../apps/extension/entrypoints/sidepanel/App.tsx) es la
interfaz principal del panel. Contiene:

- Detección de la pestaña activa.
- Captura de ofertas.
- Pestaña `Post IA`: el usuario pega el texto de un post de LinkedIn.
- Detección automática del correo dentro del texto pegado.
- Formulario para el correo del reclutador y la URL del post.
- Botón `Generar borrador con IA`.
- Revisión editable del destinatario, el asunto y el cuerpo antes de enviar.
- Botón `Enviar correo` en la pantalla de revisión.
- Vista de descubrimiento de ofertas.
- Estado de sincronización.
- Acceso a postulaciones y recordatorios.

El panel no lee el DOM de LinkedIn. El texto del post se pega manualmente y el
parser vive en `lib/linkedin-post.ts`.

#### `dashboard/main.tsx` y `dashboard/App.tsx`

El dashboard es la aplicación completa de Postulia. Incluye vistas para:

- Resumen.
- Lista de postulaciones.
- Kanban.
- Recordatorios.
- Ajustes.
- Importación y exportación.

Los archivos de vistas están en
[`entrypoints/dashboard/views/`](../apps/extension/entrypoints/dashboard/views/).

### 2.2 Librerías principales de la extensión

#### Extracción de ofertas

[`lib/extractors/`](../apps/extension/lib/extractors/) contiene los
extractores de ofertas laborales:

- `linkedin.ts`
- `computrabajo.ts`
- `indeed.ts`
- `generic.ts`
- `page-kind.ts`
- `index.ts`

Esta parte busca datos de una vacante (`jobTitle`, `company`, `location`,
`url`, etc.). No es la parte que procesa posts de LinkedIn.

#### Texto pegado de un post de LinkedIn

La lógica específica está en
[`lib/linkedin-post.ts`](../apps/extension/lib/linkedin-post.ts).

La extensión ya no intenta leer el DOM de LinkedIn. El usuario copia el texto
del post y lo pega en la pestaña `Post IA`. El parser hace lo siguiente:

1. Normaliza el texto: espacios, saltos de línea y el sufijo
   `Ver más`/`See more`.
2. Busca el primer correo de contacto con una expresión regular.
3. Descarta correos internos como `*@linkedin.com` y `noreply@`.
4. Busca una URL de post de LinkedIn (`/feed/update/`, `/posts/` o
   `/feed/activity/`).
5. Devuelve:

```ts
{
  text: string;
  email: string | null;
  url: string | null;
  author: string | null;  // siempre null
  postedAt: string | null; // siempre null
}
```

El correo detectado se autocompleta en un campo editable. Si el post no
incluye ninguno, el usuario puede escribirlo manualmente antes de enviar.

#### Mensajería

[`lib/messaging.ts`](../apps/extension/lib/messaging.ts) define los tipos de
mensajes entre React, el content script y el service worker.

Los mensajes relacionados con posts son:

```text
postulia:save-linkedin-post
```

La generación del borrador y el envío del correo no pasan por el service
worker: el panel llama directamente a [`lib/ia.service.ts`](../apps/extension/lib/ia.service.ts).
La función `sendMessage()` encapsula `browser.runtime.sendMessage()` y añade
un timeout para evitar que la interfaz quede esperando indefinidamente.

#### API y sesión

- [`lib/api.ts`](../apps/extension/lib/api.ts): peticiones autenticadas,
  renovación de tokens y manejo de errores.
- [`lib/auth.ts`](../apps/extension/lib/auth.ts): login, registro, logout y
  persistencia de la sesión.
- [`lib/settings.ts`](../apps/extension/lib/settings.ts): URL de API, tokens,
  usuario, CV local y preferencias.
- [`lib/ia.service.ts`](../apps/extension/lib/ia.service.ts): genera el
  borrador con IA y envía el correo ya revisado.

`ia.service.ts` no llama directamente a Gemini ni a SMTP. Solo hace peticiones
HTTP a:

```text
POST {apiUrl}/api/ia/draft-email
POST {apiUrl}/api/ia/send-email
```

#### Persistencia local

[`lib/db.ts`](../apps/extension/lib/db.ts) crea la base IndexedDB `postulia`
con Dexie. Contiene tablas para:

- `applications`
- `events`
- `reminders`
- `tags`
- `meta`
- `jobDiscoveries`
- `searchHistory`
- `searchAlerts`
- `linkedinPosts`

Los posts de LinkedIn se guardan en `linkedinPosts` con autor, texto, URL
(puede ser `null`), fecha, fecha de captura y `emailDraftId`.

[`lib/repository.ts`](../apps/extension/lib/repository.ts) contiene las
operaciones de postulaciones: crear, actualizar, cambiar estados, crear
recordatorios y detectar cambios pendientes.

[`lib/hooks.ts`](../apps/extension/lib/hooks.ts) expone consultas reactivas
para que React se actualice cuando cambia IndexedDB.

## 3. Flujo completo: post de LinkedIn a correo con IA

Este es el recorrido real del código.

### Paso 1: el usuario abre la pestaña `Post IA`

El panel lateral tiene tres pestañas: `Capturar`, `Post IA` y `Descubrir`.
La pestaña `Post IA` está pensada para propuestas laborales publicadas como
post en LinkedIn. No se lee el DOM de LinkedIn: el usuario copia el texto del
post y lo pega.

### Paso 2: se pega el texto del post

El textarea guarda el contenido en `postText`. En cada cambio se llama a:

```ts
parsePastedPost(value)
```

El parser devuelve el texto limpio, el correo detectado y la URL del post si
aparece en el texto.

### Paso 3: se autocompleta el correo

Si `parsePastedPost()` encuentra un correo, se rellena el campo
`Correo del reclutador`. El campo siempre es editable:

- si el post incluye `rrhh@empresa.com`, aparece automáticamente;
- si no incluye ninguno, el usuario lo escribe a mano;
- si detecta un correo equivocado, el usuario lo corrige.

La URL del post también se autocompleta si viene en el texto pegado. Es
opcional.

### Paso 4: se valida el formulario y se pide el borrador

Al pulsar `Generar borrador con IA`, `generatePostDraft()` comprueba:

1. Que el texto no esté vacío.
2. Que el correo, si se escribió, tenga formato válido.

Después:

1. Lee los ajustes mediante `getSettings()`.
2. Comprueba que exista `accessToken`.
3. Envía el texto, la URL y el destinatario opcional a
   `generateEmailDraft()`.

Este paso **no envía ningún correo**: solo genera un borrador.

### Paso 5: petición del borrador al backend

[`lib/ia.service.ts`](../apps/extension/lib/ia.service.ts) ejecuta:

```text
POST {settings.apiUrl}/api/ia/draft-email
Authorization: Bearer {accessToken}
Content-Type: application/json
```

El cuerpo HTTP es equivalente a:

```json
{
  "author": null,
  "text": "Texto pegado del post",
  "url": "https://www.linkedin.com/posts/...",
  "postedAt": null,
  "to": "reclutador@empresa.com"
}
```

El campo `to` solo se incluye si el usuario escribió o aceptó un correo.

### Paso 6: el backend autentica y valida

La ruta está en
[`apps/api/src/routes/users.ts`](../apps/api/src/routes/users.ts).

`userRoutes()` añade `app.authenticate` como `preHandler`, por lo que el
access token debe ser válido. Después valida el cuerpo con Zod:

```ts
const draftEmailSchema = z.object({
  to: z.string().nullish(),
  author: z.string().nullish(),
  text: z.string().nullish(),
  url: z.string().nullish(),
  postedAt: z.string().nullish(),
});
```

### Paso 7: se obtiene el CV del usuario

El backend busca el CV mediante el `userId` del token:

```text
UserCv -> text
UserCv -> filePath
UserCv -> fileName
```

El CV se sube previamente desde Ajustes mediante:

```text
POST /api/users/cv
```

La API acepta PDF, extrae el texto con `pdf-parse` y guarda:

- el archivo en `.uploads/{userId}.pdf`;
- el texto extraído en PostgreSQL;
- el nombre del archivo;
- la fecha de subida.

Si no existe un CV con texto, el endpoint de borrador devuelve un error y no
llama a Gemini.

### Paso 8: se construye el prompt para Gemini

El backend combina:

1. Autor del post.
2. Fecha.
3. URL.
4. Texto del post.
5. Texto del CV.

Le pide a Gemini que:

- encuentre un correo en el post;
- redacte un correo profesional en español;
- use únicamente experiencia presente en el CV;
- no invente datos;
- devuelva solo JSON con `to`, `subject` y `body`;
- entregue el cuerpo en texto plano, sin HTML ni Markdown.

La llamada se hace a:

```text
https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent
```

La API key se obtiene de `GEMINI_API_KEY` en el entorno del backend.

### Paso 9: se determina el destinatario del borrador

El backend prioriza:

1. El correo introducido manualmente en `to`.
2. El correo que Gemini haya encontrado en el post.

`normalizeRecipient()` extrae un patrón de correo para evitar devolver texto
arbitrario. Si no hay destinatario, el borrador se devuelve con `to: null` y el
usuario debe escribirlo en la pantalla de revisión.

La respuesta tiene esta forma:

```json
{
  "ok": true,
  "to": "reclutador@empresa.com",
  "subject": "Asunto generado",
  "body": "Hola,\n\nMe interesa la oportunidad..."
}
```

El `body` está en texto plano.

### Paso 10: la UI muestra el borrador editable

`App.tsx` guarda el borrador en `postDraft` y cambia `postStage` a `review`.
La pestaña `Post IA` muestra:

- destinatario;
- asunto;
- cuerpo completo del mensaje;
- botón `Enviar correo`;
- botón `Regenerar borrador`;
- botón `Volver`.

Los tres campos son editables. Nada se envía en este paso. Si el usuario
cambia el texto pegado o vuelve atrás, el borrador se descarta para evitar
enviar contenido desactualizado.

### Paso 11: el usuario confirma el envío

Al pulsar `Enviar correo`, `sendReviewedPost()` valida:

1. Que el destinatario sea un correo válido.
2. Que el asunto no esté vacío.
3. Que el cuerpo no esté vacío.

Después llama a `sendReviewedEmail()` con exactamente los valores revisados:

```text
POST {settings.apiUrl}/api/ia/send-email
Authorization: Bearer {accessToken}
Content-Type: application/json
```

```json
{
  "to": "reclutador@empresa.com",
  "subject": "Asunto revisado",
  "body": "Cuerpo revisado por el usuario"
}
```

Este endpoint **no vuelve a llamar a Gemini**: envía lo que el usuario aprobó.

### Paso 12: el backend envía el correo por SMTP

La ruta valida el cuerpo con `sendReviewedEmailSchema`, busca el CV del usuario
y crea un transportador Nodemailer con:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
```

Envía:

- destinatario revisado;
- asunto revisado;
- cuerpo revisado convertido de texto plano a HTML seguro;
- CV PDF como adjunto, si el archivo puede leerse.

La respuesta exitosa tiene esta forma aproximada:

```json
{
  "ok": true,
  "to": "reclutador@empresa.com",
  "subject": "Asunto revisado",
  "message": "Correo enviado a reclutador@empresa.com con tu CV adjunto."
}
```

### Paso 13: se guarda el post y se muestra el resultado

Solo cuando el envío responde con éxito, el panel guarda el post:

```ts
{
  type: "postulia:save-linkedin-post",
  post
}
```

El service worker busca un registro con la misma URL. Si existe, devuelve
`{ ok: true, duplicate: true, id }`; si no, crea un `LinkedInPostRecord` con
`crypto.randomUUID()` y lo guarda en `db.linkedinPosts`. La URL puede ser
`null` cuando el post pegado no la incluye.

Después `App.tsx` cambia `postStage` a `sent` y muestra el mensaje en verde. Si
el envío falla, vuelve a `review`, conserva el borrador y muestra el error en
rojo para que el usuario pueda corregirlo y reintentar.

## 4. Diagrama del flujo de LinkedIn

```text
Usuario copia el texto del post en LinkedIn
        │
        ▼
Pestaña “Post IA” del panel lateral
        │
        ▼
lib/linkedin-post.ts: parsePastedPost()
        │
        ├── detecta correo (ignora @linkedin.com)
        ├── detecta URL del post
        └── limpia el texto
        │
        ▼
Usuario revisa/corrige el correo y pulsa
“Generar borrador con IA”
        │
        ▼
lib/ia.service.ts
        │ POST /api/ia/draft-email
        ▼
API: routes/users.ts
        │
        ├── autentica JWT
        ├── carga CV desde PostgreSQL
        └── llama a Gemini y devuelve borrador
        │
        ▼
Panel: borrador editable
        │
        ├── destinatario
        ├── asunto
        └── cuerpo en texto plano
        │
        ▼
Usuario corrige y pulsa “Enviar correo”
        │
        ▼
lib/ia.service.ts
        │ POST /api/ia/send-email
        ▼
API: routes/users.ts
        │
        ├── valida {to, subject, body}
        ├── carga CV y adjunto PDF
        ├── convierte texto plano a HTML
        └── envía por SMTP (sin volver a llamar a Gemini)
        │
        ▼
respuesta a SidePanelApp
        │
        ├── guarda el post en db.linkedinPosts
        └── muestra “Correo enviado” o error
```

## 5. Aplicación API

La API está en [`apps/api/`](../apps/api/). Usa Fastify, Prisma y PostgreSQL.

### Archivos principales

- [`src/index.ts`](../apps/api/src/index.ts): carga variables de entorno,
  crea la aplicación y abre el puerto.
- [`src/app.ts`](../apps/api/src/app.ts): registra CORS, multipart,
  rate-limit, Prisma, autenticación y rutas.
- [`src/env.ts`](../apps/api/src/env.ts): valida configuración con Zod.
- [`src/plugins/auth.ts`](../apps/api/src/plugins/auth.ts): JWT y
  `app.authenticate`.
- [`src/plugins/prisma.ts`](../apps/api/src/plugins/prisma.ts): cliente Prisma.
- [`src/lib/password.ts`](../apps/api/src/lib/password.ts): hash y
  verificación de contraseñas.
- [`src/lib/tokens.ts`](../apps/api/src/lib/tokens.ts): refresh tokens.
- [`src/routes/auth.ts`](../apps/api/src/routes/auth.ts): registro, login,
  refresh, logout y usuario actual.
- [`src/routes/applications.ts`](../apps/api/src/routes/applications.ts):
  postulaciones.
- [`src/routes/sync.ts`](../apps/api/src/routes/sync.ts): sincronización
  incremental.
- [`src/routes/reminders.ts`](../apps/api/src/routes/reminders.ts):
  recordatorios.
- [`src/routes/stats.ts`](../apps/api/src/routes/stats.ts): estadísticas.
- [`src/routes/tags.ts`](../apps/api/src/routes/tags.ts): etiquetas.
- [`src/routes/users.ts`](../apps/api/src/routes/users.ts): CV y correo con IA.

### Base de datos

[`prisma/schema.prisma`](../apps/api/prisma/schema.prisma) define las tablas
principales:

- `User`
- `RefreshToken`
- `Application`
- `ApplicationEvent`
- `Reminder`
- `Tag`
- `ApplicationTag`
- `UserCv`

Los archivos de
[`prisma/migrations/`](../apps/api/prisma/migrations/) contienen la evolución
del esquema.

## 6. Paquete compartido

[`packages/shared/`](../packages/shared/) evita duplicar contratos entre
extensión y API.

Contiene:

- tipos de postulaciones;
- estados y etiquetas;
- esquemas de entrada;
- normalización y hash de URLs;
- fechas;
- sincronización;
- descubrimiento;
- pruebas unitarias.

La extensión y la API deben compilar primero el paquete compartido porque
consumen su salida `dist`.

## 7. Configuración de IA y correo

La ruta de IA necesita estas variables en `apps/api/.env`:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
```

También necesita la configuración general:

```env
DATABASE_URL=...
JWT_SECRET=una-clave-de-al-menos-32-caracteres
CORS_ORIGINS=chrome-extension://*
```

La extensión necesita:

1. Tener configurada la URL de la API.
2. Tener una sesión iniciada.
3. Tener un CV PDF cargado en Ajustes.
4. Que la API tenga Gemini configurado.
5. Que la API tenga SMTP configurado.
6. Que el post contenga un correo o que se introduzca manualmente.

## 8. Qué revisar si no aparece la funcionalidad

### No se detecta el correo en el texto

Revisar:

1. Que el texto pegado contenga un correo con formato válido.
2. Que no sea un correo interno de LinkedIn (`@linkedin.com`).
3. Que el correo no tenga espacios ni caracteres raros alrededor.
4. Si no aparece ninguno, escríbelo manualmente en `Correo del reclutador`.

### El botón de IA no aparece o está deshabilitado

El botón `Generar borrador con IA` vive en la pestaña `Post IA` y se
deshabilita cuando el textarea está vacío o hay una generación en curso.

En la pantalla de revisión, `Enviar correo` se deshabilita si falta el
destinatario, el asunto o el cuerpo, o si el envío está en curso.

La UI relevante está en la pestaña `post` de
[`sidepanel/App.tsx`](../apps/extension/entrypoints/sidepanel/App.tsx).

### La IA no genera el borrador

Revisar en este orden:

1. Sesión iniciada en la extensión.
2. `settings.apiUrl` apunta a la API correcta.
3. El servidor responde en `POST /api/ia/draft-email`.
4. El token JWT no está vencido.
5. Existe un CV en `UserCv` con texto extraído.
6. `GEMINI_API_KEY` está configurada.
7. `GEMINI_MODEL` es válido.

### El correo no se envía

Revisar:

1. Que el borrador tenga destinatario válido, asunto y cuerpo.
2. Que el servidor responda en `POST /api/ia/send-email`.
3. Que `SMTP_HOST`, `SMTP_USER` y `SMTP_PASS` estén configurados.
4. Que el servidor pueda leer el PDF guardado en `.uploads`.

### Comprobaciones útiles

```bash
# Construir el contrato compartido
npm run build:shared

# Comprobar tipos
npm run typecheck

# Ejecutar pruebas
npm test

# Ejecutar la API
npm run dev:api

# Ejecutar la extensión
npm run dev:ext
```

## 9. Distinción importante: oferta laboral versus post

Postulia tiene dos flujos diferentes:

| Flujo | Entrada | Resultado |
|---|---|---|
| Captura de oferta | Página de una vacante | Postulación local con puesto, empresa y estado |
| Post de LinkedIn + IA | Texto pegado por el usuario | Correo generado por Gemini y enviado por SMTP |

Un post de LinkedIn no se convierte automáticamente en una `Application`. Se
guarda en `linkedinPosts` y se usa como contexto para el correo. La
postulación tradicional utiliza los extractores de ofertas y el mensaje
`postulia:capture`.
