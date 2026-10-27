# Publicación en Chrome Web Store

Checklist operativo para publicar Postulia. Las respuestas están redactadas para copiar y pegar en el formulario de la tienda.

## 1. Estado del paquete

```bash
npm test
npm run typecheck
npm run build -w @postulia/extension
npm run zip -w @postulia/extension
```

Artefacto generado:

```
apps/extension/.output/postulia-0.1.0-chrome.zip
```

Comprobaciones del `manifest.json` incluido:

| Campo                       | Valor                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Nombre                      | `Postulia — Seguimiento de postulaciones` (39 caracteres)                           |
| Descripción                 | 120 caracteres (límite de Chrome: 132)                                              |
| Versión                     | `0.1.0`                                                                             |
| Chrome mínimo               | `116` (`sidePanel.open` y `setPanelBehavior`)                                       |
| Permisos                    | `storage`, `alarms`, `notifications`, `sidePanel`, `tabs`, `activeTab`, `scripting` |
| Host permissions            | 6 portales de empleo                                                                |
| Host permissions opcionales | Ninguna: la v0.1 no se conecta a servidores                                         |

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
• Consulta estadísticas de tu proceso.
• Exporta o importa tus datos en JSON y CSV.

Funciona sin cuenta: toda la información se guarda en tu navegador y no se envía a ningún servidor.

Postulia no incluye publicidad, telemetría ni venta de datos. No envía postulaciones automáticamente.
```

**Categoría:** Productividad
**Idioma:** Español
**Sitio web / soporte:** `https://github.com/SGDIEGO/postulia`
**Correo de contacto:** el de la cuenta de desarrollador

**Política de privacidad:**

```
https://github.com/SGDIEGO/postulia/blob/main/PRIVACY.md
```

## 3. Justificación de permisos

Copia cada texto en el campo correspondiente del formulario.

**`storage`**

> Guarda preferencias de la interfaz, como el estado de la barra lateral. Los datos de las postulaciones se guardan en IndexedDB dentro del navegador.

**`alarms`**

> Programa recordatorios de seguimiento y la comprobación periódica de alertas de búsqueda. No hay sincronización con servidores.

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

**¿Se usa código remoto?**

> No. Todo el JavaScript está incluido en el paquete y no se evalúa código descargado.

**¿Se usa `eval()` o `new Function()`?**

> No.

## 4. Prácticas de privacidad

Declarar en el formulario de la tienda:

- **¿Se recopilan datos?** No. Todo se guarda en el navegador y no se transmite a ningún servidor.
- **Categorías:** ninguna. Los datos de las postulaciones, recordatorios y ofertas permanecen en el almacenamiento local del navegador.
- **¿Se venden datos?** No.
- **¿Se usan para publicidad?** No.
- **¿Se usan para fines no relacionados?** No.
- **¿Se usan para evaluar solvencia o préstamos?** No.
- **Limited Use:** sí, el uso se limita a las funciones descritas en la política.
- **URL de privacidad:** la indicada arriba.

## 5. Assets

- [x] Icono 128×128 en `apps/extension/public/icon/128.png`.
- [ ] 1–5 capturas de 1280×800 (PNG o JPEG) del panel lateral y del panel de control.
- [ ] Captura del kanban, de los ajustes locales y de una oferta capturada.
- [ ] (Opcional) imagen promocional 440×280 para destacados.

Las capturas deben hacerse con un perfil limpio y datos de ejemplo, sin correos ni nombres reales.

## 6. QA antes de enviar

- [ ] Instalar el ZIP en un perfil limpio de Chrome.
- [ ] Modo local: la barra lateral no muestra “Servidor” ni sesión, y Ajustes no muestra servidor, preferencias ni sincronización.
- [ ] Capturar una oferta en cada portal compatible.
- [ ] Probar el capturador bajo demanda en un portal no listado.
- [ ] Crear, editar, mover en kanban y borrar una postulación.
- [ ] Crear un recordatorio y comprobar la notificación.
- [ ] Ejecutar una búsqueda de descubrimiento y guardar una oferta.
- [ ] Exportar JSON y CSV, borrar los datos y volver a importar.
- [ ] Abrir la política de privacidad desde Ajustes.
- [ ] Revisar la consola del service worker y del panel: sin errores.
- [ ] Verificar que no hay peticiones a dominios ajenos a los portales de empleo.

## 7. Envío

1. Cuenta de desarrollador verificada, con 2FA y la tasa única de registro.
2. Subir el ZIP en el **Chrome Web Store Developer Dashboard**.
3. Completar ficha, categoría, idioma, URLs y prácticas de privacidad.
4. Declarar la condición de comerciante si distribuyes en la UE (DSA).
5. Enviar a revisión. El plazo habitual es de 1 a 7 días.
6. Tras la aprobación, instalar desde la tienda y repetir el QA del punto 6.

## 8. Después del lanzamiento

- Etiquetar la versión en git (`v0.1.0`).
- Guardar el ZIP publicado como artefacto de la release.
- Para la siguiente versión: subir `version` en `apps/extension/wxt.config.ts` y en `apps/extension/package.json`.
- Si se habilita un servicio hospedado, actualizar `PRIVACY.md`, la ficha y las prácticas de privacidad antes de publicar.
