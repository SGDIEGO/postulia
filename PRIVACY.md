# Política de privacidad de Postulia

**Última actualización:** 26 de octubre de 2026
**Versión de la extensión:** 0.1.0

Postulia es una extensión de Chrome para registrar y dar seguimiento a postulaciones laborales. Funciona **sin cuenta y de forma local**: tus datos se guardan en el navegador y no se envían a ningún servidor.

## Resumen

- **No hay telemetría, analítica, publicidad ni venta de datos.**
- **No hay servidores de Postulia.** El proyecto no opera un servicio hospedado.
- **Ningún dato sale de tu equipo.**
- Todo se guarda en tu navegador y puedes exportarlo o borrarlo cuando quieras.

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

Los datos de configuración se limitan a las preferencias locales de la interfaz (por ejemplo, si la barra lateral está contraída). No hay cuentas, correo ni tokens de sesión.

La extensión **no** recopila identificadores de usuario, datos de salud, datos financieros, ubicación precisa del dispositivo ni historial de navegación general.

## Dónde se guardan los datos

### Almacenamiento local

Todo se guarda en **IndexedDB** dentro de tu perfil de Chrome, más algunas preferencias en `chrome.storage`. Estos datos:

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
- **No** se venden ni se comparten datos con terceros.
- Al abrir o buscar en un portal de empleo, la petición la hace tu navegador directamente contra ese portal; el portal puede registrar la visita según sus propias políticas.
- Postulia no está afiliada a LinkedIn, Indeed, Computrabajo, Bumeran, Get on Board ni Torre.

## Retención y eliminación

- **Datos locales:** se conservan hasta que los borres. Puedes eliminar postulaciones desde la papelera de la extensión, exportar un respaldo o desinstalar la extensión.
- **Ofertas descubiertas:** se eliminan automáticamente después de unos **30 días**.
- **Historial de búsquedas y alertas:** se conserva hasta que lo borres.

## Seguridad

- La extensión no ejecuta código remoto ni carga scripts de terceros.
- No hay cuentas, tokens de sesión ni conexiones a servidores propios.
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
