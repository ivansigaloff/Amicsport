# Integración WhatsApp — Análisis de arquitectura y plan

> Documento de análisis para integrar la **WhatsApp Business Cloud API** en Amicsport:
> apuntarse a partidos, onboarding de usuarios, pagos y consentimiento/GDPR.
> Estado: **análisis / diseño** (no implementado). Última actualización: 2026-06.

---

## 0. TL;DR

- La integración **no usa SAP ni un servicio Java aparte**. La pieza correcta es **una Edge Function de Supabase más** (Deno/TS), igual que `monei-webhook` y `send-match-notification`.
- El stack actual (Supabase + Edge Functions + Monei + RLS) ya tiene **casi todo** lo necesario; WhatsApp se engancha encima reutilizando tablas, RPCs y el flujo de pago existentes.
- Camino de **menor fricción y riesgo**: usar el **grupo de WhatsApp actual como embudo** → el usuario escribe al número del bot con un link pre-rellenado `wa.me?text=VOY <código>` → el bot apunta / registra / cobra dentro de la **ventana de 24h** (sin plantillas para la parte conversacional).
- Onboarding sin fricción: **el número de WhatsApp es la identidad**; la cuenta se crea con solo teléfono + nombre, **sin contraseña**. La contraseña (o mejor, OTP/magic-link) queda como algo **exclusivo de la web** y diferible.
- GDPR: el grueso (registro + jugar + pagar) va por **ejecución de contrato**, no por consentimiento. El **consentimiento explícito** solo hace falta para mensajes **proactivos/marketing**.

---

## 1. Contexto: stack actual de Amicsport

| Pieza | Tecnología | Dónde vive |
|---|---|---|
| Frontend | Expo React Native (web estático) | FTP → `multigraf.info/Kickerzbcn` |
| Backend datos/auth | Supabase (Postgres + RLS) | Cloud Supabase |
| Lógica servidor | Edge Functions (Deno/TS) | Supabase `/functions/v1/...` |
| Pagos | Monei (`create-payment`, `monei-webhook`, `refund-payment`, `reconcile-payments`, `verify-payment`) | Edge Functions |
| Notificaciones | Edge Function `send-match-notification` → endpoint PHP (email) | Supabase + multigraf |
| Modelo de datos | `matches`, `match_participants`, `payments`, audit log | Postgres |
| Joins atómicos | RPC `join_match` / `reserve_paid_slot` (lock de fila, control de cupo) | Postgres |

Datos relevantes ya existentes:
- `profiles.phone?: string` (**opcional** hoy → muchos usuarios no lo tienen).
- `TODO.md` ya contempla *"Notificaciones: WhatsApp y push"* en la hoja de ruta.
- Soporte de **invitados** (guests), reserva atómica de plaza, cola de refunds y retornos asíncronos.

**Conclusión:** WhatsApp es una Edge Function nueva que reaprovecha esta infraestructura. Nada de stacks ajenos.

---

## 2. Por qué NO el adaptador SAP / servicio Java

Existe un prototipo en `WhatsAppAdapter` (adaptador SAP CI en Java) y un mini-bot Java standalone. Sirvieron para **entender el flujo** (verificar firma HMAC → parsear webhook → comando → responder/pagar), pero:

- El adaptador SAP solo tiene sentido dentro de un landscape SAP Integration Suite (caro, pesado, irrelevante aquí).
- Un servicio Java aparte = otro despliegue que mantener, otra base de datos que sincronizar.
- Toda esa lógica se reimplementa en **~100 líneas de Deno/TS** dentro de Supabase, reutilizando DB, RLS, Monei y audit log.

Lo aprovechable del prototipo son **los conceptos**, no el código:
verificación HMAC-SHA256, parseo del payload de Meta, parser de comandos tolerante (voy/no voy/lista), reintentos y rate limiting.

---

## 3. Dónde se publica cada cosa

- **Webhook de WhatsApp = nueva Edge Function** `whatsapp-webhook`, desplegada con:
  ```bash
  supabase functions deploy whatsapp-webhook --no-verify-jwt
  ```
  Su URL pública `https://<project>.supabase.co/functions/v1/whatsapp-webhook` se registra en el **panel de Meta** como callback (igual que `monei-webhook` se registra en Monei).
- **Secrets en Supabase** (mismo modelo que `MONEI_API_KEY`):
  - `WHATSAPP_TOKEN` — access token de Meta.
  - `WHATSAPP_PHONE_NUMBER_ID` — Phone Number ID.
  - `WHATSAPP_APP_SECRET` — para verificar el HMAC del webhook (`X-Hub-Signature-256`).
  - `WHATSAPP_VERIFY_TOKEN` — para el handshake GET de verificación.
- **El frontend RN no cambia de sitio** ni participa en el flujo de mensajería: WhatsApp habla directo con la Edge Function.
- **Envío saliente** (responder, mandar link de pago): desde la Edge Function a `graph.facebook.com`. Cero infraestructura nueva.

---

## 4. Patrón del webhook (espejo de `monei-webhook`)

Dos entradas HTTP que el runtime enruta:

- `GET /whatsapp-webhook` — **handshake de verificación** de Meta
  (`hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`). Devuelve el challenge solo si el verify token coincide.
- `POST /whatsapp-webhook` — **callbacks de eventos**, protegidos por **HMAC-SHA256** con el App Secret. Verificar firma → parsear → despachar → responder `200` rápido (Meta reintenta si no).

```
GET  → verificación (echo de hub.challenge)
POST → verify HMAC → parse → comando → acción (join / registro / pago) → responder 200
```

---

## 5. El grupo de WhatsApp como embudo (recomendado para arrancar)

**Problema base:** la Cloud API **no puede leer grupos**. **Solución:** no se lee el grupo; se usa como lanzadera hacia el bot 1-a-1.

Ventajas que desbloquea:
1. **Abre la ventana de 24h:** como el **usuario inicia** la conversación, durante 24h se puede responder con **texto libre, sin plantillas aprobadas**. Elimina la fricción de aprobación de Meta para toda la parte conversacional.
2. **Da el teléfono** (`from`) → momento natural para vincular/crear cuenta.
3. **No lee el grupo:** el grupo sigue humano, gestionado como hasta ahora.

### El truco: link `wa.me` con texto pre-rellenado por partido

Si el usuario solo escribe "voy", el bot **no sabe a qué partido**. Se resuelve con un enlace click-to-chat que **ya lleva comando + código de partido**:

```
https://wa.me/34XXXXXXXXX?text=VOY%20A7F3
```

Al tocarlo, su WhatsApp se abre con *"VOY A7F3"* ya escrito; solo pulsa enviar. El bot recibe `from` + `"VOY A7F3"`, parsea `A7F3` → sabe el partido y el usuario exactos. Sin ambigüedad y sin "no te entendí". Cada partido del grupo tiene así su propio botón **Apuntarme** (y análogos `NOVOY A7F3`, `LISTA A7F3`).

**Pendiente mínimo:** el bot **no puede postear en el grupo** → lo publica un humano (o se pega al crear el partido). Hay que **generar un código corto** por partido (campo nuevo o derivado del `id`).

---

## 6. Los dos retos técnicos reales

### 6.1 Identidad: teléfono de WhatsApp → usuario de Supabase
WhatsApp identifica al remitente solo por su **número E.164** (`from`), garantizado por Meta. Necesario:
- Normalizar y **guardar el teléfono** en el perfil (hoy `phone` es opcional).
- Mapear `from` → `profiles.phone` → `user_id`.
- Números no vinculados → flujo de **auto-registro** (ver §7) o tratar como **invitado**.

### 6.2 Autorización: `join_match` exige JWT; el webhook es service-role
El RPC `join_match` usa `auth.uid()` (necesita sesión de usuario). El webhook corre con **service role**, donde `auth.uid()` es `null`. Dos caminos:
- **(Recomendado)** crear `join_match_as(p_user_id, …)` `SECURITY DEFINER`, ejecutable **solo por service role**, reutilizando la misma lógica de cupo/locking. Una sola fuente de verdad para la capacidad.
- O insertar directo en `match_participants` con service role + recuento manual (como el camino de pago vía `confirmSlot`). Más frágil.

---

## 7. Onboarding sin fricción: el número ES la identidad

Cuando alguien escribe al bot, Meta garantiza el `from` (número real autenticado). Es una **prueba de identidad sólida** — mejor que un email sin verificar.

- **Canal WhatsApp:** cada acción va firmada implícitamente por su número → **no necesita login nunca**. El teléfono es la sesión.
- **Web:** ahí sí hace falta acceso (contraseña *o* código), porque el navegador no aporta el número verificado.
- ⇒ **La contraseña es un problema solo de la web, y diferible.**

### Crear la cuenta con solo teléfono + nombre (sin password)

Desde la Edge Function (service role):

```ts
await admin.auth.admin.createUser({
  phone: '+34600111222',
  phone_confirm: true,                 // verificado: vino por WhatsApp
  user_metadata: { full_name: 'Iván' },
});
```

Dos formas de pedir el nombre:

- **Opción A — Conversacional (mínima fricción):** el bot pregunta el nombre en el chat, el usuario responde, se crea la cuenta ahí mismo. Cero links/formularios.
- **Opción B — Link a mini-formulario web:** mejor cuando necesitas **consentimiento GDPR** o más datos. **Importante de seguridad:** el link debe llevar el teléfono en un **token de un solo uso firmado (HMAC/JWT)**, nunca el teléfono en crudo en la URL (si no, alguien registraría un número ajeno). El formulario verifica el token en servidor → extrae teléfono → crea la cuenta.

### Login posterior en la web
Como ya posees el canal WhatsApp, lo más limpio es **passwordless**:

| Método | Cómo | Nota |
|---|---|---|
| OTP por WhatsApp/SMS | "te mando un código" | Coherente con el canal; requiere proveedor OTP en Supabase |
| Magic link por email | si dieron email opcional | Passwordless, fácil |
| Contraseña | "crea tu contraseña para la web" | Válido, pero más fricción/gestión |

### Vigilar
- Teléfono en **E.164** y **único** (una cuenta por número). `phone` pasa de opcional a identificador del canal.
- **Vincular cuentas existentes:** si alguien ya tiene cuenta web (email) y escribe por WhatsApp, ofrecer "vincular este número" en vez de duplicar.

### Flujo completo
```
[Usuario escribe / toca wa.me?text=VOY A7F3]
        ▼
[whatsapp-webhook] ¿existe usuario con este teléfono?
   ├─ Sí  → join_match_as(user) → "✅ apuntado, 7/10"
   └─ No  → pide nombre (chat) o manda link firmado
              ▼ crea usuario (phone + nombre, sin password)
              ▼ lo apunta → "✅ ¡Bienvenido y apuntado!"
        (más tarde, si entra a la web) → login por OTP/email/contraseña
```

---

## 8. Pagos por WhatsApp (reutilizando Monei)

Cuando alguien se apunta por WhatsApp a un partido con `requires_payment = true`:
- El webhook llama a una **variante service-role de `create-payment`** (reusa `reserve_paid_slot` + `moneiRequest`), obtiene el `redirectUrl` de Monei y **lo envía como mensaje de WhatsApp**.
- El usuario paga; **el `monei-webhook` existente confirma la plaza** (`confirmSlotOrRefund`). Misma reconciliación, mismo audit log, mismos refunds. **No se duplica nada.**

El "link de pago" deja de ser un enlace fijo y pasa a ser **un checkout real de Monei por jugador/partido**, con su `order_id` para conciliación automática. Todo dentro de la ventana de 24h.

---

## 9. Requisitos por el lado de Meta (no técnicos, pero bloqueantes)

- **Número dedicado** para la Cloud API (distinto del WhatsApp personal del organizador).
- **Verificación del negocio** en Meta Business Manager (puede tardar días).
- **Plantillas aprobadas** para mensajes **proactivos** (p.ej. *"Hoy hay partido, ¿juegas?"*). Las respuestas **dentro de la conversación** (cuando el user escribe) van como texto libre dentro de la **ventana de 24h**.
- **Sin grupos:** la Cloud API es 1-a-1. "El grupo del equipo" se simula enviando individualmente y agregando respuestas en la BD.
- **Coste por conversación** (hay tramo gratuito mensual; revisar tarifa de utility/marketing templates).

---

## 10. Consentimiento / GDPR

> Orientación práctica, **no asesoramiento legal**. Para producción, validar con DPO/abogado.

### 10.1 Separar por base jurídica (no todo es "consentimiento")

| Tratamiento | Base legal (Art. 6 GDPR) | ¿Consentimiento? |
|---|---|---|
| Crear cuenta, apuntar a partidos, gestionar lista | **Ejecución de contrato** (6.1.b) — servicio que el usuario pide | ❌ No |
| Confirmaciones, recordatorios, link de pago (transaccional, iniciado por él) | Contrato / interés legítimo | ❌ No (pero ver opt-in de Meta) |
| Cobro Monei + guardar recibo | Contrato + **obligación legal** (contable/fiscal) | ❌ No |
| Mensajes **proactivos / marketing** (promos, novedades) | **Consentimiento** (6.1.a) | ✅ Sí, explícito y revocable |

El grueso (registrarse y jugar) va por **contrato**. El consentimiento explícito es sobre todo para lo **proactivo/marketing**.

### 10.2 Opt-in que exige Meta (aparte del GDPR)
WhatsApp **obliga** a tener opt-in antes de enviar mensajes **iniciados por el negocio** (plantillas). Que el usuario **escriba primero** (el embudo del grupo) ya es la señal más fuerte de opt-in; aun así, conviene registrarlo explícitamente.

### 10.3 Cuándo capturarlo
1. **En el alta** (primer contacto / formulario): informar + aceptación de política.
2. **Antes del primer mensaje proactivo**, si no se captó en el alta.

### 10.4 Cómo capturarlo por WhatsApp (double opt-in)
```
Bot: "Para registrarte y enviarte avisos de tus partidos necesito tu OK.
      📄 Política: https://amicsport/privacidad
      Responde ACEPTO para continuar."
Usuario: "ACEPTO"
Bot: "✅ Registrado. (Escribe BAJA cuando quieras dejar de recibir avisos)."
```
Con **formulario web** (Opción B): checkbox **no premarcado** + enlace a política → mejor prueba.

### 10.5 Qué guardar (responsabilidad proactiva — Art. 7)
Tabla dedicada (además del `auditLog`), por consultabilidad y versión:

```sql
create table consents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users,
  phone          text,                 -- E.164
  purpose        text not null,        -- 'service' | 'transactional_msgs' | 'marketing'
  policy_version text not null,        -- 'v1.2' — qué texto aceptó
  channel        text not null,        -- 'whatsapp' | 'web_form'
  evidence       text,                 -- el "ACEPTO" literal o hash del form
  granted_at     timestamptz default now(),
  withdrawn_at   timestamptz           -- null = vigente
);
```
Clave: **versión de política** + **timestamp** + **canal** + **evidencia**.

### 10.6 Derechos y revocación
- **Baja/oposición:** keyword **BAJA**/**STOP** → marca `withdrawn_at` y deja de mandar proactivos (Meta también lo obliga). **ALTA** para reactivar.
- **Acceso/portabilidad:** exportar datos a petición.
- **Supresión ("derecho al olvido"):** borrar cuenta + **anonimizar** participaciones. *Excepción:* los **recibos de pago se conservan** por obligación legal contable (base legal distinta) — documentarlo.
- **Menores:** si la usan menores, consentimiento parental; decidir edad mínima.

### 10.7 Retención (definir y publicar en la política)
- Cuenta y participaciones: mientras activo + X meses tras baja.
- Logs de auditoría: plazo de seguridad.
- Pagos/facturas: plazo legal contable (en España, varios años).

### 10.8 Encaje con el stack
- **Controlador:** Amicsport. **Encargados (processors):** Supabase (datos), Meta (WhatsApp), Monei (pagos) → firmar/aceptar sus **DPA** estándar.
- **Política de privacidad:** alojada en la web (`multigraf.info/...`), enlazada desde bot y formulario; debe identificar controlador, finalidades, bases legales, processors, retención y ejercicio de derechos.
- **Implementación:** `whatsapp-webhook` escribe en `consents` al registrar; keywords BAJA/ALTA actualizan `withdrawn_at`; endpoint/cron para export y borrado.

### 10.9 Supervisión de conversaciones: ¿reenviar a otro número o registrar?

**Pregunta:** ¿se puede hacer que cualquier conversación bot↔usuario se reenvíe a otro teléfono (supervisión)?

**Sí, es viable** — una llamada extra a la Graph API por cada mensaje (inbound y outbound) hacia el número supervisor. Pero tiene pegas:
- **Coste y límites de Meta:** cada reenvío es un mensaje **facturable**, y si el supervisor no ha escrito al bot en las últimas 24h, fuera de esa ventana harían falta **plantillas aprobadas** → fricción y coste.
- **GDPR:** reenviar conversaciones a un tercero es un **tratamiento adicional** (y posible **cesión**) de datos personales. Necesita base legal y, sobre todo, estar **informado en la política de privacidad** (quién accede a los mensajes y para qué). **Nunca de forma oculta.**

**Mejor para supervisión: registrar en BD + panel admin** (en vez de reenviar a un móvil). Encaja directamente con el stack actual de Amicsport:

- **Tabla dedicada `whatsapp_messages`** — NO el `audit_log` general: ese guarda **eventos de negocio discretos** (`PAYMENT_SUCCEEDED`, `REFUND_ISSUED`…) y el chat es un **stream de alto volumen** con forma propia. Esquema sugerido:
  ```sql
  create table whatsapp_messages (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid references auth.users,   -- null si aún no vinculado
    phone         text not null,                -- E.164
    direction     text not null,                -- 'in' | 'out'
    wa_message_id text,                         -- id de Meta (idempotencia/dedupe)
    body          text,
    raw           jsonb,                         -- payload completo por si acaso
    created_at    timestamptz default now()
  );
  ```
  El **evento de negocio derivado** ("se apuntó por WhatsApp") sí va al `audit_log` existente vía `auditLog()` (añadiendo `'whatsapp'` a su campo `source`).
- **Escritura:** el `whatsapp-webhook` inserta cada inbound; el sender outbound inserta cada respuesta. Una sola fuente, con `wa_message_id` para dedupe (igual que `monei-webhook` es idempotente).
- **Panel:** una pantalla admin nueva `app/admin/whatsapp.tsx`, reutilizando el **patrón de guard ya endurecido** en el resto de pantallas admin (`computeIsAdmin` + redirección, como `pagos.tsx`) y **RLS admin-only**: política `whatsapp_messages_admin_select USING auth_is_admin()` (clonando `audit_log_admin_select`). Da **búsqueda, histórico y exportación** sin consumir mensajes de pago ni chocar con la ventana de 24h.

**Ventaja de control:** el registro en BD es **auditable y con acceso restringido** (RLS) — "supervisión por el responsable del tratamiento" — en vez de una **cesión opaca** a un móvil personal. Aun así, **ambos** casos deben constar en la **política de privacidad**, que en esta app es una pantalla real (`app/legal/privacidad.tsx`) a actualizar: finalidad (soporte/supervisión), quién accede (admins) y base legal (interés legítimo / ejecución de contrato).

---

## 11. Posibilidades / casos de uso

| Caso | Dirección | Complejidad |
|---|---|---|
| "voy / no voy" desde WhatsApp → actualiza `match_participants` | Inbound | Media (identidad) |
| Consultar "lista" del partido | Inbound | Baja |
| Convocatoria automática X horas antes (plantilla) | Outbound | Media (plantillas) |
| Recordatorio + link de pago Monei al apuntarse a partido de pago | Inbound→Outbound | Media (reusa Monei) |
| Aviso "entraste desde la lista de espera" al caerse un titular | Outbound | Baja (engancha a la promoción de waitlist) |
| Confirmación de pago recibido | Outbound | Baja (engancha a `monei-webhook`) |
| Supervisión de conversaciones (registro + panel admin) | Interna | Baja-Media (tabla `whatsapp_messages` + RLS admin; ver §10.9) |

---

## 12. Plan por fases

1. **Fase 0 — Setup Meta:** número, verificación de negocio, app, token, plantillas básicas. *(Lo más lento; empezar ya.)*
2. **Fase 1 — Outbound only (bajo riesgo):** Edge Function que, desde la lógica actual de join/leave/waitlist, **envía notificaciones** por WhatsApp (réplica de `send-match-notification` pero a Graph API). No requiere resolver identidad inversa (ya sabes `user_id` + teléfono). Valor inmediato.
3. **Fase 2 — Inbound "voy/no voy/lista":** `whatsapp-webhook` + mapeo teléfono→usuario + RPC `join_match_as` + auto-registro + `consents`.
4. **Fase 3 — Pagos por WhatsApp:** link Monei al apuntarse a partidos de pago.

**Recomendación:** empezar por **Fase 1** (máximo valor, mínimo riesgo, no toca identidad/auth).

---

## 13. Componentes nuevos a construir (resumen)

- Edge Function `whatsapp-webhook` (GET verificación + POST eventos, verify HMAC, router de comandos).
- Edge Function/handler outbound (envío a Graph API) — Fase 1.
- RPC `join_match_as(p_user_id, …)` (service-role) — Fase 2.
- Lógica de **auto-registro** (phone + nombre, sin password) + token firmado para el formulario web.
- Tabla `consents` + handlers **ACEPTO / BAJA / ALTA**.
- Generador de **código corto por partido** + helper de link `wa.me?text=...`.
- Variante service-role de `create-payment` para el flujo de pago por WhatsApp — Fase 3.
- Secrets de WhatsApp en Supabase + registro del callback en el panel de Meta.
- Política de privacidad publicada + DPAs firmados.
- *(Opcional, supervisión)* Tabla `whatsapp_messages` + pantalla admin `app/admin/whatsapp.tsx` para registrar y revisar conversaciones — alternativa recomendada al reenvío a otro número (ver §10.9).

---

## 14. Decisiones abiertas

- ¿Auto-registro **conversacional** (Opción A) o **formulario web** (Opción B) para el alta?
- ¿Login web **passwordless** (OTP/magic-link) o **contraseña**?
- ¿Código de partido: campo nuevo o derivado del `id`?
- Edad mínima / tratamiento de menores.
- Plazos de retención concretos.
- Supervisión de conversaciones: ¿registro en BD + panel admin (recomendado) o reenvío a otro número? (ver §10.9)
