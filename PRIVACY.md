# Política de privacidad de Postulia

**Última actualización:** 17 de noviembre de 2026
**Versión de la extensión:** 0.3.0

Postulia es una extensión de Chrome para registrar y dar seguimiento a postulaciones laborales. Funciona con los datos en tu navegador y, si creas una cuenta, sincroniza una copia con el servidor de Postulia para que puedas usarla desde otro equipo y recibir correos de tu proceso.

## Resumen

- **No hay telemetría, analítica, publicidad ni venta de datos.**
- Sin cuenta, todo se queda en tu navegador.
- Con cuenta, los datos de tu búsqueda de empleo se guardan en el servidor de Postulia para sincronizarlos. Puedes borrar tu cuenta y tus datos cuando quieras.
- La única salida de correo es el servidor SMTP de Postulia: verificación de la cuenta y los correos que tú pidas (por ejemplo, un CV para un reclutador).
- Puedes exportar o borrar los datos locales desde la extensión.

## Qué datos trata la extensión

### Datos de la cuenta (opcionales)

- **Identificación:** correo electrónico y, si lo indicas, tu nombre.
- **Credenciales:** la contraseña se guarda en el servidor solo como hash; los tokens de sesión se guardan como hash.
- **Verificación:** la fecha en que confirmaste el correo y los enlaces de verificación emitidos (se guardan como hash y caducan).

Si no creas una cuenta, estos datos no existen y no se envía nada.

### Datos que tú creas

- **Postulaciones:** puesto, empresa, enlace de la oferta, ubicación, modalidad de trabajo, salario y moneda, tipo de contrato, estado, fechas, notas, etiquetas, nombre y contacto del reclutador y versión de CV (texto).
- **Historial:** cambios de estado y eventos asociados a cada postulación.
- **Recordatorios:** mensajes y fechas de seguimiento.
- **Preferencias:** días de seguimiento, notificaciones y estado de la interfaz.
- **CV:** el texto que extrae la extensión del PDF que subes, para generar correos.

### Datos de descubrimiento de ofertas

- Términos de búsqueda, filtros aplicados e historial de búsquedas.
- Ofertas encontradas en portales públicos (título, empresa, ubicación, modalidad, salario, enlace y portal de origen).
- Alertas de búsqueda que tú creas.

### Datos de configuración

La extensión guarda la URL del servidor, los tokens de sesión y la configuración del proveedor de IA. La API key de Gemini se envía al servidor por una conexión segura, se almacena cifrada y no se devuelve en las respuestas.

Cuando generas un borrador, el servidor envía a Google Gemini el contenido del post y el texto de tu CV junto con tu solicitud. Revisa los términos y la política de privacidad del plan de Google Gemini que uses.

La extensión **no** recopila datos de salud, datos financieros, ubicación precisa del dispositivo ni historial de navegación general.

## Dónde se guardan los datos

### Almacenamiento local

Los datos locales se guardan en **IndexedDB** dentro de tu perfil de Chrome, más algunas preferencias en `chrome.storage`. Estos datos:

- Permanecen en tu equipo.
- Se eliminan si desinstalas la extensión o borras los datos del sitio.
- Puedes exportarlos a JSON o CSV desde **Ajustes → Datos**.

### Servidor de Postulia

Si inicias sesión, la extensión sincroniza tus postulaciones, su historial, recordatorios, etiquetas, preferencias de notificaciones y el texto del CV con el servidor de Postulia (`https://155-181-165-241.sslip.io`). El servidor:

- Guarda esos datos asociados a tu cuenta y los aísla del resto de usuarios.
- Cifra en reposo la API key de IA cuando la configuras.
- No usa tus datos para publicidad ni los comparte con terceros, salvo los proveedores necesarios para prestar la función que pides (Google Gemini para redactar y el proveedor de correo para enviar los mensajes).

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
| Host permission opcional     | Conectar con el servidor de Postulia, solo al crear la cuenta o iniciar sesión.       |

## Terceros

- **No** se usan servicios de analítica, publicidad, rastreo ni redes sociales.
- Postulia no vende datos.
- **Google Gemini:** si usas la función de IA, el servidor comparte el CV y el contenido del post para generar el borrador.
- **Proveedor de correo:** el servidor usa un servidor SMTP propio para enviar la verificación de la cuenta y los correos que tú pidas. No se usa para marketing.
- Al abrir o buscar en un portal de empleo, la petición la hace tu navegador directamente contra ese portal; el portal puede registrar la visita según sus propias políticas.
- Postulia no está afiliada a LinkedIn, Indeed, Computrabajo, Bumeran, Get on Board ni Torre.

## Retención y eliminación

- **Datos locales:** se conservan hasta que los borres. Puedes eliminar postulaciones desde la papelera de la extensión, exportar un respaldo o desinstalar la extensión.
- **Datos del servidor:** se conservan mientras la cuenta exista. Puedes pedir el borrado de la cuenta y de todos sus datos desde el repositorio del proyecto; se eliminan también los tokens, las verificaciones y el CV.
- **Ofertas descubiertas:** se eliminan automáticamente después de unos **30 días**.
- **Historial de búsquedas y alertas:** se conserva hasta que lo borres.
- **Enlaces de verificación:** caducan a los 30 minutos y se invalidan al usarse.

## Seguridad

- La extensión no ejecuta código remoto ni carga scripts de terceros.
- El servidor usa autenticación con token, contraseñas con hash y cifra la API key de IA almacenada.
- Las peticiones a portales de empleo las hace tu navegador directamente contra ese portal.

## Menores de edad

Postulia no está dirigida a menores de 16 años y no recopila conscientemente datos de menores.

## Uso limitado de la información

El uso de la información obtenida a través de los permisos de la extensión se limita a las funciones descritas en esta política: capturar ofertas que el usuario decide guardar y gestionar sus postulaciones, recordatorios y correos. No se usa para publicidad, creación de perfiles, venta de datos ni fines no relacionados.

## Cambios en esta política

Si la política cambia, se actualizará este documento y la fecha de la parte superior. Los cambios sustanciales se anunciarán en las notas de la versión de la extensión.

## Contacto

Para preguntas sobre privacidad, abre un issue en:
<https://github.com/SGDIEGO/postulia/issues>
