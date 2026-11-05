# Política de privacidad de Postulia

**Última actualización:** 26 de octubre de 2026
**Versión de la extensión:** 0.1.0

Postulia es una extensión de Chrome para registrar y dar seguimiento a postulaciones laborales. Puede funcionar localmente o conectarse a una API que tú configures.

## Resumen

- **No hay telemetría, analítica, publicidad ni venta de datos.**
- Si configuras una API, los datos necesarios para sincronizar se envían a ese servidor.
- Puedes exportar o borrar los datos locales desde la extensión.

## Qué datos trata la extensión

### Datos que tú creas

- **Postulaciones:** puesto, empresa, enlace de la oferta, ubicación, modalidad de trabajo, salario y moneda, tipo de contrato, estado, fechas, notas, etiquetas, nombre y contacto del reclutador y versión de CV (texto).
- **Historial:** cambios de estado y eventos asociados a cada postulación.
- **Recordatorios:** mensajes y fechas de seguimiento.
- **Preferencias:** días de seguimiento, notificaciones y estado de la interfaz.

### Datos de descubrimiento de ofertas

- Términos de búsqueda, filtros aplicados e historial de búsquedas.
- Ofertas encontradas en portales públicos (título, empresa, ubicación, modalidad, salario, enlace y portal de origen).
- Alertas de búsqueda que tú creas.

### Datos de configuración

La extensión puede guardar la URL de la API, tokens de sesión y la configuración del proveedor de IA. La API key de Gemini se envía al servidor por una conexión segura, se almacena cifrada y no se devuelve en las respuestas.

Cuando generas un borrador, el servidor envía a Google Gemini el contenido del post y el texto de tu CV junto con tu solicitud. Revisa los términos y la política de privacidad del plan de Google Gemini que uses.

La extensión **no** recopila identificadores de usuario, datos de salud, datos financieros, ubicación precisa del dispositivo ni historial de navegación general.

## Dónde se guardan los datos

### Almacenamiento local

Los datos locales se guardan en **IndexedDB** dentro de tu perfil de Chrome, más algunas preferencias en `chrome.storage`. Estos datos:

- Permanecen en tu equipo.
- No se transmiten a Postulia ni a terceros.
- Se eliminan si desinstalas la extensión o borras los datos del sitio.
- Puedes exportarlos a JSON o CSV desde **Ajustes → Datos**.

## Permisos y para qué se usan

| Permiso                      | Uso                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `storage`                    | Guardar preferencias de la interfaz.                                                  |
| `alarms`                     | Programar recordatorios y la comprobación de alertas de búsqueda.                     |
| `notifications`              | Mostrar recordatorios de seguimiento.                                                 |
| `sidePanel`                  | Mostrar la interfaz de Postulia en el panel lateral.                                  |
| `tabs`                       | Detectar la pestaña activa para capturar la oferta que estás viendo y abrir el panel. |
| `activeTab`                  | Capturar la oferta actual solo cuando pulsas el icono de Postulia.                    |
| `scripting`                  | Inyectar el capturador en la pestaña activa o leer listados en portales compatibles.  |
| Host permissions de portales | Leer la oferta en LinkedIn, Indeed, Computrabajo, Bumeran, Get on Board y Torre.      |

## Terceros

- **No** se usan servicios de analítica, publicidad, rastreo ni redes sociales.
- Postulia no vende datos. Si usas la función de IA, el servidor configurado comparte el CV y el contenido del post con Google Gemini para generar el borrador.
- Al abrir o buscar en un portal de empleo, la petición la hace tu navegador directamente contra ese portal; el portal puede registrar la visita según sus propias políticas.
- Postulia no está afiliada a LinkedIn, Indeed, Computrabajo, Bumeran, Get on Board ni Torre.

## Retención y eliminación

- **Datos locales:** se conservan hasta que los borres. Puedes eliminar postulaciones desde la papelera de la extensión, exportar un respaldo o desinstalar la extensión.
- **Ofertas descubiertas:** se eliminan automáticamente después de unos **30 días**.
- **Historial de búsquedas y alertas:** se conserva hasta que lo borres.

## Seguridad

- La extensión no ejecuta código remoto ni carga scripts de terceros.
- La API usa autenticación y cifra la API key de IA almacenada en el servidor.
- Las peticiones a portales de empleo las hace tu navegador directamente contra ese portal.

## Menores de edad

Postulia no está dirigida a menores de 16 años y no recopila conscientemente datos de menores.

## Uso limitado de la información

El uso de la información obtenida a través de los permisos de la extensión se limita a las funciones descritas en esta política: capturar ofertas que el usuario decide guardar y gestionar sus postulaciones y recordatorios en el navegador. No se usa para publicidad, creación de perfiles, venta de datos ni fines no relacionados.

## Cambios en esta política

Si la política cambia, se actualizará este documento y la fecha de la parte superior. Los cambios sustanciales se anunciarán en las notas de la versión de la extensión.

## Contacto

Para preguntas sobre privacidad, abre un issue en:
<https://github.com/SGDIEGO/postulia/issues>
