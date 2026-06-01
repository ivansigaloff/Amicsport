# Conversación completa — Análisis de integración WhatsApp

> Transcripción de la sesión de trabajo que dio origen a [`WHATSAPP_INTEGRATION.md`](./WHATSAPP_INTEGRATION.md).
> Guardada para que otro agente pueda retomar el contexto. Fecha: 2026-06.
>
> **Contexto para el próximo agente:** la conversación empezó analizando un repo aparte
> (`C:\Users\IvanSigaloff\.gemini\antigravity\scratch\WhatsAppAdapter`, un adaptador SAP CI en
> Java + un mini-bot Java standalone construido como prototipo) y terminó concluyendo que la
> integración real para **Amicsport** debe hacerse como **Edge Function de Supabase**, no con SAP/Java.
> El análisis destilado está en `WHATSAPP_INTEGRATION.md`. Aquí queda el razonamiento paso a paso.

---

## Resumen de hallazgos técnicos (lo que el agente descubrió del repo Amicsport)

- App **Expo/React Native** (web estático), desplegada por **FTP** a `multigraf.info/Kickerzbcn`.
- Backend **Supabase**: Postgres + Auth + RLS + **Edge Functions (Deno/TS)**.
- Pagos **Monei** ya integrados: `create-payment`, `monei-webhook`, `refund-payment`,
  `reconcile-payments`, `verify-payment`, helpers en `_shared/` (`monei.ts`, `confirmSlot.ts`, `audit.ts`).
- Notificaciones email vía `send-match-notification` → endpoint PHP (con `X-Internal-Auth`).
- Modelo: `matches` (id, title, venue, date, time, price, requires_payment, max_players,
  joined_players, creator_email), `match_participants`, `payments`, audit log.
- Joins atómicos: RPC `join_match(uuid, text, boolean)` `SECURITY DEFINER` que usa `auth.uid()`
  (requiere JWT), y `reserve_paid_slot` para el camino de pago.
- `profiles.phone?: string` existe pero es **opcional**.
- `TODO.md` ya lista *"Notificaciones: WhatsApp y push"*.
- `monei-webhook`: verifica firma Monei, idempotente, confirma plaza vía `confirmSlotOrRefund`,
  devuelve 200 rápido. Es el patrón a replicar para el webhook de WhatsApp.

---

## Transcripción (turnos usuario ↔ asistente)

### 👤 Usuario
> clona este proyecto en esta carpeta https://github.com/ivansigaloff/WhatsAppAdapter.git, despues analizalo a fondo

### 🤖 Asistente
Clonó el repo `WhatsAppAdapter` y lo analizó a fondo. Resumen del análisis:

- **Qué es:** adaptador personalizado de WhatsApp para **SAP Cloud Integration (CPI/CI)**, con
  el **ADK de SAP** + **Apache Camel**, empaquetado como bundle OSGi. Dos variantes: *Sender*
  (consumer, webhooks entrantes) y *Receiver* (producer, envío saliente a Meta).
- **Arquitectura:** separación entre lógica `whatsapp/` y utilidades reutilizables `common/`
  (auth, http, security, expression).
- **Bien hecho:** HMAC en tiempo constante, `HttpApiClient` con `HttpURLConnection` (sin deps
  pesadas), retry con backoff (solo 429/5xx), tokens vía Secure Store.
- **Problemas/incompletos:** el webhook del consumer estaba "simulado" (no conectado a HTTP);
  credenciales OAuth dummy; `setUserCredential` comentado (no persiste token); sin tests; sin README.
- **Veredicto:** esqueleto bien estructurado pero parcialmente implementado (MVP estructural).

### 👤 Usuario
> completa binding, test y readme

### 🤖 Asistente
Verificó tooling (Java 8 + Maven 3.9; las deps SAP `com.sap.cloud.adk` **sí resolvían** —el usuario
tiene un repo SAP configurado—, por lo que pudo compilar y testear de verdad). Entregó:

1. **Binding del webhook** — reescribió `WhatsAppConsumer.java` con manejadores HTTP reales y
   testeables: `handleVerification(mode, token, challenge)` (handshake GET, echo de challenge) y
   `handleWebhook(payload, signature)` (verifica HMAC → parsea → crea Exchange → enruta al iFlow),
   ambos devolviendo un `WebhookResponse(statusCode, body)` mapeable a HTTP (200/401/403/500).
   Añadió constante `HEADER_SENDER`.
2. **Tests** — 34 tests JUnit 5 (HmacSignatureVerifier, MessageBuilder, WebhookPayloadParser,
   ExpressionExtractor, RetryPolicy, RateLimiter, WhatsAppConsumer). `BUILD SUCCESS`.
3. **README.md** — visión general, variantes, arquitectura, configuración, build, testing, limitaciones.

### 👤 Usuario
> se podría utilizar este adaptador para gestionar partidos de futbol desde whatsapp? o sin adaptador y solo funciones que conecten whatsapp con un backend?

### 🤖 Asistente
Respondió que **técnicamente sí con el adaptador, pero para gestionar partidos no merece la pena**:
el adaptador SAP solo tiene sentido con SAP Integration Suite. Recomendó la **Opción B: WhatsApp
Cloud API + backend (funciones)**, más barata y simple. Señaló que buena parte de las clases
`common/` del repo son reutilizables (HmacSignatureVerifier, WebhookPayloadParser, MessageBuilder,
HttpApiClient/RetryPolicy/RateLimiter). Avisos importantes de la Cloud API: **ventana de 24h**
(fuera de ella solo plantillas aprobadas) y que **no se pueden leer/enviar a grupos** (es 1-a-1).

### 👤 Usuario
> si

### 🤖 Asistente
Construyó un **prototipo standalone de la Opción B** en el paquete `com.custom.football` dentro del
repo `WhatsAppAdapter`, reutilizando las clases limpias de `common/` y usando el servidor HTTP del
JDK (sin deps nuevas):

- `MatchService` — estado del partido en memoria (titulares, suplentes, promoción automática).
- `CommandParser` — interpreta "voy/no voy/lista/ayuda" (tolerante a acentos/mayúsculas; LEAVE
  antes que JOIN para que "no voy" gane).
- `MatchBot` — orquesta comando→acción→respuesta; incluye **link de pago opcional** al apuntarse de titular.
- `WhatsAppSender` (usa `HttpApiClient` + `MessageBuilder`), `StaticBearerTokenProvider`,
  `FootballWebhookServer` (GET verificación + POST HMAC), `FootballApp` (main con env vars).
- 16 tests nuevos (50 en total). `BUILD SUCCESS`.

### 👤 Usuario
> se podría enviar un link de pago a un usuario que se apunta a un partido? *(enviado mientras el asistente construía el prototipo)*

### 🤖 Asistente
Sí, y lo dejó integrado en el prototipo: al entrar de titular, si hay `PAYMENT_LINK` configurado,
el bot añade el enlace con `?ref=<teléfono>` para conciliación. Explicó que **WhatsApp no procesa
el cobro** — lo hace una pasarela externa (Stripe Payment Link, Bizum, PayPal, Redsys/Monei).
Recomendó, en producción, crear un **checkout único por jugador/partido** y conciliar vía el
webhook de la pasarela. Matices: el link puede ir como texto dentro de la ventana de 24h; el cobro
proactivo posterior requeriría plantilla; WhatsApp Pay nativo solo en India/Brasil.

### 👤 Usuario
> seria para usarlo en esta aplicación. Analiza la integracion, donde habría que publicar la aplicacion, posibilidades, etc: C:\Users\IvanSigaloff\.gemini\antigravity\scratch\Amicsport

### 🤖 Asistente
Analizó Amicsport (ver "Resumen de hallazgos" arriba) y **corrigió el rumbo**: aquí no va SAP ni
el prototipo Java; la integración correcta es **una Edge Function de Supabase más**
(`whatsapp-webhook`), reutilizando DB, RLS, Monei y audit log. Explicó dónde se publica cada cosa
(Edge Function + secrets en Supabase; el callback se registra en Meta; el frontend RN no cambia),
los **dos retos reales** (identidad teléfono→usuario; el webhook es service-role mientras
`join_match` exige JWT → crear `join_match_as`), cómo reutilizar Monei para pagos, los requisitos
de Meta, casos de uso y un **plan por fases** (empezar por outbound, Fase 1).

### 👤 Usuario
> ahora mismo hay un grupo de partidos, si se le pidiese al usuario desde ahi q si quiere apuntarse a un partido, le escriba al numero de la api, facilitaria las cosas?

### 🤖 Asistente
Sí, **la jugada más inteligente** para empezar: usa el grupo como **embudo** hacia el bot 1-a-1,
esquivando la limitación de grupos y la fricción de plantillas. Ventajas: abre la **ventana de 24h**
(respuestas en texto libre), da el teléfono para vincular cuenta, no lee el grupo. **Truco clave:**
link `wa.me/<num>?text=VOY%20A7F3` por partido (lleva comando + código), de modo que el bot sabe a
qué partido y usuario sin ambigüedad. Pendiente: un humano publica el link en el grupo (el bot no
puede postear en grupos) y hay que generar un código corto por partido.

### 👤 Usuario
> se les podría decir que escriban al telefono api, y este les de un link para creación de usuario, que solo tengan que poner su nombre y grabar? la contraseña solo seria necesario para gestiones desde la web, no?

### 🤖 Asistente
Sí, y la intuición es correcta: **la contraseña es solo cosa de la web y diferible**. El **número de
WhatsApp es la identidad** (Meta garantiza el `from`). La cuenta se crea desde la Edge Function
(service role) con `auth.admin.createUser({ phone, phone_confirm: true, user_metadata: { full_name }})`,
**sin password**. Dos formas de pedir el nombre: **conversacional** (mínima fricción) o
**formulario web** (mejor para GDPR; el link debe llevar el teléfono en un **token firmado de un
solo uso**, nunca en crudo). Login web posterior: recomendable **passwordless** (OTP por
WhatsApp/SMS o magic-link email); la contraseña es opcional. Vigilar: E.164 + unicidad de teléfono,
y vincular cuentas existentes en vez de duplicar.

### 👤 Usuario
> como se podria gestionar el Consentimiento/GDPR y cuando

### 🤖 Asistente
Explicó la gestión GDPR (ver §10 de `WHATSAPP_INTEGRATION.md`): **separar por base jurídica**
(registro/jugar/pagar = **contrato**, no consentimiento; solo **marketing/proactivo** =
**consentimiento**); el **opt-in que exige Meta** para mensajes iniciados por el negocio; **cuándo**
capturarlo (en el alta y antes del primer proactivo); **cómo** por WhatsApp (**double opt-in**
"ACEPTO" o checkbox en formulario); **qué guardar** (tabla `consents` con purpose + versión de
política + timestamp + canal + evidencia); **derechos y revocación** (keywords BAJA/STOP/ALTA,
acceso, supresión conservando recibos por obligación legal, menores); **retención**; y el encaje con
el stack (DPAs de Supabase/Meta/Monei, política de privacidad en la web). Con disclaimer de que no
es asesoramiento legal.

### 👤 Usuario
> quiero que escribas todo este analisis de integracion/whatsapp en un documento en la carpeta de Amicsport, y que guardes también toda la conversacion para que otro agente pueda leerla.

### 🤖 Asistente
Creó `docs/WHATSAPP_INTEGRATION.md` (análisis completo) y este `docs/WHATSAPP_INTEGRATION_CONVERSATION.md` (transcripción).

---

## Estado y próximos pasos sugeridos (para el próximo agente)

- **Nada implementado en Amicsport todavía** — todo es análisis/diseño.
- El prototipo Java vive en `C:\Users\IvanSigaloff\.gemini\antigravity\scratch\WhatsAppAdapter`
  (paquete `com.custom.football`) y sirve solo como **referencia conceptual**; no se despliega.
- Decisiones abiertas pendientes (ver §14 del análisis): auto-registro conversacional vs formulario;
  login web passwordless vs contraseña; código de partido (campo nuevo vs derivado del id);
  edad mínima/menores; plazos de retención.
- Siguiente paso recomendado por el asistente: **Fase 1 (outbound)** — replicar
  `send-match-notification` pero enviando a la Graph API de WhatsApp. Alternativamente, empezar el
  `whatsapp-webhook` inbound con `join_match_as` + auto-registro + tabla `consents`.
