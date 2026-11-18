# Publicación en Chrome Web Store

Checklist operativo para publicar Postulia. Las respuestas están redactadas para copiar y pegar en el formulario de la tienda.

## 1. Estado del paquete

```bash
npm test
npm run typecheck
npm run zip -w @postulia/extension
```

Artefacto generado:

```
apps/extension/.output/postulia-0.3.0-chrome.zip
```

Comprobaciones del `manifest.json` incluido:

| Campo                       | Valor                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Nombre                      | `Postulia — Seguimiento de postulaciones` (39 caracteres)                           |
| Descripción                 | 120 caracteres (límite de Chrome: 132)                                              |
| Versión                     | `0.3.0`                                                                             |
| Chrome mínimo               | `116` (`sidePanel.open` y `setPanelBehavior`)                                       |
| Permisos                    | `storage`, `alarms`, `notifications`, `sidePanel`, `tabs`, `activeTab`, `scripting` |
| Host permissions            | 6 portales de empleo                                                                |
| Host permissions opcionales | `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` para el servidor de la API |

La extensión apunta al servidor de producción (`https://155-181-165-241.sslip.io`) en `apps/extension/lib/settings.ts`. El permiso del servidor se pide en tiempo de ejecución, al crear la cuenta o iniciar sesión; no se concede al instalar.

## 2. Ficha de la tienda

**Nombre (máx. 45):**

```
Postulia — Seguimiento de postulaciones
```

**Descripción corta (máx. 132):**

```
Guarda ofertas de LinkedIn, Computrabajo e Indeed y organiza tus postulaciones con kanban, recordatorios y estadísticas.
```

**Descripción detallada (sugerencia):**

```
Postulia te ayuda a llevar el control de tu búsqueda de empleo sin hojas de cálculo.

• Guarda una oferta desde LinkedIn, Computrabajo, Indeed, Bumeran, Get on Board o Torre con un clic.
• Captura también ofertas de otros portales desde el panel lateral.
• Organiza tus postulaciones en lista o tablero kanban: guardada, postulada, entrevista, oferta, rechazada.
• Añade notas, etiquetas, reclutador y versión de CV.
• Crea recordatorios de seguimiento y recibe notificaciones.
• Genera un borrador de correo para el reclutador con tu CV.
• Consulta estadísticas de tu proceso.
• Exporta o importa tus datos en JSON y CSV.

Puedes usar Postulia sin cuenta: todo se queda en tu navegador. Si creas una cuenta, confirma tu correo una vez y tus datos se sincronizan entre equipos.

Postulia no incluye publicidad, telemetría ni venta de datos. No envía postulaciones automáticamente.
```

**Categoría:** Productividad
**Idioma:** Español
**Sitio web / soporte:** `https://github.com/SGDIEGO/postulia`
**Correo de contacto:** `postulia@deliveryrm.com.pe`

**Política de privacidad:**

```
https://github.com/SGDIEGO/postulia/blob/main/PRIVACY.md
```

## 3. Justificación de permisos

Copia cada texto en el campo correspondiente del formulario.

**`storage`**

> Guarda preferencias de la interfaz, como el estado de la barra lateral. Los datos de las postulaciones se guardan en IndexedDB dentro del navegador.

**`alarms`**

> Programa recordatorios de seguimiento y la comprobación periódica de alertas de búsqueda, y reintenta la sincronización con el servidor cuando hay sesión.

**`notifications`**

> Muestra recordatorios de seguimiento al usuario.

**`sidePanel`**

> Es la interfaz principal de la extensión: permite capturar la oferta activa y consultar postulaciones y recordatorios sin abandonar la pestaña.

**`tabs`**

> Lee la URL de la pestaña activa para detectar si es una oferta compatible y abrir el panel de control. No se registra el historial de navegación.

**`activeTab`**

> Permite inyectar el capturador en la pestaña actual solo cuando el usuario pulsa el icono de Postulia, para portales sin integración específica.

**`scripting`**

> Inyecta el capturador y lee los listados de ofertas en los portales compatibles cuando el usuario inicia la acción.

**Host permissions (`linkedin.com`, `indeed.com`, `computrabajo.com`, `bumeran.com`, `getonbrd.com`, `torre.ai`)**

> Leer el contenido de la oferta o del listado en los portales de empleo compatibles para que el usuario pueda guardarla. No se accede a otros sitios.

**Host permission opcional (`https://*/*`, localhost)**

> Conectar con el servidor de Postulia para crear la cuenta, iniciar sesión, sincronizar las postulaciones y generar correos con IA. Se solicita solo cuando el usuario pulsa «Crear cuenta» o «Iniciar sesión», y el usuario puede denegarla y seguir usando la extensión en modo local.

**¿Se usa código remoto?**

> No. Todo el JavaScript está incluido en el paquete y no se evalúa código descargado.

**¿Se usa `eval()` o `new Function()`?**

> No.

## 4. Prácticas de privacidad

La v0.3.0 puede sincronizar datos con el servidor del proyecto, así que **la declaración ya no es «no se recopilan datos»**. Marca:

- **¿Se recopilan datos?** Sí.
- **Información de identificación personal:** dirección de correo electrónico y nombre (solo si el usuario crea una cuenta).
- **Contenido del usuario:** postulaciones, notas, recordatorios, etiquetas y texto del CV (solo con cuenta; en modo local no salen del navegador).
- **Actividad en la web:** la extensión lee la oferta de la página activa cuando el usuario la guarda; no se envía el historial de navegación.
- **¿Se venden datos?** No.
- **¿Se usan para publicidad?** No.
- **¿Se usan para fines no relacionados?** No.
- **¿Se usan para evaluar solvencia o préstamos?** No.
- **Limited Use:** sí, el uso se limita a las funciones descritas en la política. Los datos no se usan para entrenar modelos ni se comparten con terceros salvo Google Gemini (solo al generar un correo) y el proveedor SMTP (solo para enviar el mensaje solicitado).
- **Certificación de Limited Use:** marcarla.
- **URL de privacidad:** la indicada arriba.

## 5. Assets

- [x] Icono 128×128 en `apps/extension/public/icon/128.png`.
- [x] 5 capturas de 1280×800 en `docs/store/screenshots/`:
  - `01-resumen.png`
  - `02-postulaciones.png`
  - `03-kanban.png`
  - `04-recordatorios.png`
  - `05-ajustes.png`
- [ ] (Opcional) imagen promocional 440×280 para destacados.

Las capturas usan datos de ejemplo y no contienen datos personales. Conviene regenerarlas con la interfaz 0.3.0 antes de enviar.

## 6. QA antes de enviar

- [ ] Instalar el ZIP en un perfil limpio de Chrome.
- [ ] Modo local: guardar, editar y borrar una postulación sin cuenta, y comprobar que no hay peticiones al servidor.
- [ ] Crear una cuenta con un correo real: llega el mensaje, el enlace confirma y la extensión entra sola.
- [ ] Comprobar los errores: correo ya registrado, contraseña corta, enlace caducado y reenvío con espera de 60 s.
- [ ] Cerrar sesión y volver a entrar; la sesión sobrevive al reinicio del navegador.
- [ ] Capturar una oferta en cada portal compatible.
- [ ] Probar el capturador bajo demanda en un portal no listado.
- [ ] Crear, editar, mover en kanban y borrar una postulación.
- [ ] Crear un recordatorio y comprobar la notificación.
- [ ] Ejecutar una búsqueda de descubrimiento y guardar una oferta.
- [ ] Generar un borrador de correo y enviarlo a un buzón propio.
- [ ] Exportar JSON y CSV, borrar los datos y volver a importar.
- [ ] Abrir la política de privacidad desde Ajustes.
- [ ] Revisar la consola del service worker y del panel: sin errores.
- [ ] Verificar que no hay peticiones a dominios ajenos a los portales de empleo, al servidor de Postulia y a Gemini.

## 7. Envío

1. Cuenta de desarrollador verificada, con 2FA y la tasa única de registro.
2. Subir `apps/extension/.output/postulia-0.3.0-chrome.zip` en el **Chrome Web Store Developer Dashboard**.
3. Completar ficha, categoría, idioma, URLs y prácticas de privacidad (punto 4).
4. Justificar los permisos con los textos del punto 3, incluido el permiso opcional del servidor.
5. Declarar la condición de comerciante si distribuyes en la UE (DSA).
6. Enviar a revisión. El plazo habitual es de 1 a 7 días.
7. Tras la aprobación, instalar desde la tienda y repetir el QA del punto 6.

## 8. Después del lanzamiento

- Etiquetar la versión en git (`v0.3.0`).
- Guardar el ZIP publicado como artefacto de la release.
- Fijar el id publicado en el servidor: `CORS_ORIGINS=chrome-extension://<id>` en `docker/.env` y `docker compose up -d api`.
- Para la siguiente versión: subir `version` en `apps/extension/wxt.config.ts` y en `apps/extension/package.json`.
- Si cambia el tratamiento de datos (nuevo proveedor de IA, correo o sincronización), actualizar `PRIVACY.md`, la ficha y las prácticas de privacidad **antes** de publicar.
