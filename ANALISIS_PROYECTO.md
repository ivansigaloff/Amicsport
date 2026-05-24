# Análisis profundo del proyecto AmicSport

Fecha: 2026-05-22
Stack: React Native + Expo (Router v6) + Supabase (PostgreSQL + Auth).
Plataformas: iOS / Android / Web (multigraf.info/Kickerzbcn).
Alcance: ~6,250 LOC TypeScript/TSX en `app/`, `components/`, `lib/`, `hooks/`.

---

## TL;DR — Top hallazgos por severidad

| # | Severidad | Hallazgo | Fichero |
|---|---|---|---|
| 1 | **🚨 CRÍTICO** | Códigos de invitación admin hardcoded en el bundle del frontend (`ADMINKKZ2026`, `KZ2026`…) | `app/login.tsx:56-59` |
| 2 | **🚨 CRÍTICO** | `role` y `is_dev` se guardan en `user_metadata` (user-controlled) — privilegio admin asignable por el propio usuario sin pasar por el login | `app/login.tsx:83-93` + 6 sitios usan `user_metadata.role` |
| 3 | **Alto** | `app/(tabs)/index.tsx` con 1585 líneas (home screen + MatchCard + calendar + filtros + share + admin) | `app/(tabs)/index.tsx` |
| 4 | **Alto** | `app/dev/` duplica `app/` con ~3,400 LOC en deriva (1439 líneas de diff sólo en `(tabs)/index.tsx`) | `app/dev/(tabs)/index.tsx`, `app/dev/admin/crear-partido.tsx`, … |
| 5 | **Alto** | `supabase_types.ts` está vacío (1 byte). Sin tipos generados de Supabase → cero seguridad de tipos en queries | `supabase_types.ts` |
| 6 | **Alto** | 13 scripts dev en raíz del proyecto (`query_db_*.js`, `debug_*.js`, `create_*.js`) + CSV con datos de usuarios reales | raíz del repo |
| 7 | **Medio** | Notificaciones email via PHP endpoint sin auth (`multigraf.info/send_match_update.php`) — posible spam vector | `lib/services/notificationService.ts:16` |
| 8 | **Medio** | URL `multigraf.info/Kickerzbcn/...` hardcodeado en 4 sitios | `_layout.tsx`, `login.tsx`, `notificationService.ts` |
| 9 | **Medio** | Validación de cancelación + permisos admin sólo client-side; bypasseable | `hooks/match/useMatchActions.ts:34-38`, `useMatch.ts:39` |
| 10 | **Medio** | `deleteMatchTransaction` hace 2 deletes no-atómicos (participantes + match) | `lib/services/matchService.ts:20-24` |
| 11 | **Bajo** | Sin tests (cero `*.test.*` o `*.spec.*` en todo el repo) | — |
| 12 | **Bajo** | 20 `console.log/error/warn` activos en código de producción | varios |
| 13 | **Bajo** | `MapView` duplicado entre `.tsx` (211L) y `.web.tsx` (334L) — patrón Expo pero divergente | `components/MapView*` |

---

## 1. Arquitectura

### 1.1 Estructura

```
app/                          File-based routing (Expo Router)
├── _layout.tsx (118L)        Auth gate + theme + i18n + fonts + Cookies + Stack
├── index.tsx (13L)           Redirect a (tabs)
├── login.tsx (334L)          Login + Signup + Reset password
├── reset-password.tsx
├── (tabs)/                   Bottom tabs (PROD)
│   ├── _layout.tsx (66L)
│   ├── index.tsx (1585L)     🚨 Home — MatchCard + calendar + filtros + share + admin
│   ├── explore.tsx (232L)    Mapa Google Maps + filtros
│   └── menu.tsx (213L)       Perfil + logout + idiomas
├── admin/                    Pantallas administrativas
│   ├── crear-partido.tsx (769L)  🚨 Wizard de creación/edición con modal de ubicaciones
│   └── jugadores.tsx (242L)  Agenda de jugadores invitados
├── match/[id].tsx (5L)       Wrapper que renderiza components/MatchDetails
├── modal.tsx                 Modal genérico
├── legal/                    Términos, privacidad
└── dev/                      🚨 Duplicación masiva del entorno prod (ver 4.)
    ├── _layout.tsx (8L)
    ├── (tabs)/
    │   ├── _layout.tsx (46L)
    │   ├── index.tsx (940L)  Copia divergente del index prod
    │   └── explore.tsx (132L)
    ├── admin/
    │   ├── crear-partido.tsx (2L)  ✓ Re-export (correcto)
    │   └── jugadores.tsx (2L)      ✓ Re-export (correcto)
    └── match/[id].tsx (2L)         ✓ Re-export (correcto)

components/
├── MatchDetails.tsx (138L)   Pantalla de detalle modular (compone los Match*)
├── MapView.tsx (211L)        Mapa native
├── MapView.web.tsx (334L)    Mapa web (@react-google-maps/api)
├── CookieBanner.tsx (111L)
├── match/                    Sub-componentes de MatchDetails
│   ├── MatchHeader.tsx (82L)
│   ├── MatchLocationCard.tsx (33L)
│   ├── MatchParticipantsList.tsx (71L)
│   ├── MatchAdminPanel.tsx (143L)
│   └── MatchActionBar.tsx (104L)
├── ui/
└── themed-text.tsx, parallax-scroll-view.tsx, ...

hooks/
├── use-env.tsx (63L)         Context que decide prod/dev y mapea tablas (matches → matches_dev)
├── use-color-scheme.ts(.web).ts
└── match/
    ├── useMatch.ts (114L)    Estado del partido + permisos + deadlines
    └── useMatchActions.ts (124L)  toggleJoin, addGuest, removeParticipant, executeDelete

lib/
├── supabase.ts (49L)         Cliente Supabase con UniversalStorageAdapter (web+móvil)
├── i18n.ts (53L)             react-i18next con es/en/ca
├── date.ts (81L)             parseMatchDate + formatLocalizedDate (custom)
├── share.ts (150L)           shareMatch, shareMultipleMatches, validatePassword, getBaseUrl
├── venueImages.ts (20L)
└── services/                 Capa fina sobre Supabase
    ├── matchService.ts (24L)
    ├── participantService.ts (47L)
    └── notificationService.ts (40L)
```

### 1.2 Lo que funciona bien

- **Pantalla `MatchDetails` correctamente descompuesta** en sub-componentes (Header / LocationCard / Participants / AdminPanel / ActionBar) + dos hooks `useMatch`/`useMatchActions`. Es el ejemplo a seguir para el resto.
- **`use-env` hook** + `fromTable()` resuelve elegantemente la dualidad prod/dev sin duplicar lógica (cuando se usa bien — ver 4.).
- **`UniversalStorageAdapter` en `supabase.ts`** maneja SSR/web/móvil sin caer en `window is not defined`.
- **i18n configurado** con 3 idiomas (es/en/ca) incluyendo locale del calendario.
- **Capa `lib/services/`** funcional para Supabase queries — buena separación de responsabilidades, aunque incompleta (no cubre todo).

---

## 2. Seguridad

### 🚨 2.1 Códigos de invitación hardcoded en el frontend (CRÍTICO)

`app/login.tsx:56-59`:
```js
const DEV_ADMIN_CODE = 'DEV_ADMIN';
const DEV_PLAYER_CODE = 'DEV_PART';
const PROD_ADMIN_CODE = 'ADMINKKZ2026';   // ⚠️ visible en el bundle
const PLAYER_CODE = 'KZ2026';
```

Esos códigos viajan en el JS bundle público (`multigraf.info/Kickerzbcn/`). Cualquier persona puede abrir DevTools, ver el código, registrarse con `ADMINKKZ2026` y entrar como admin.

**Mitigación inmediata:**
- Mover la validación de invite codes a un endpoint server-side (Supabase Edge Function o RPC). El cliente envía el código, el servidor valida y devuelve el `role` autorizado.
- Hashear/rotarlos.

### 🚨 2.2 `role` como user_metadata (CRÍTICO)

`app/login.tsx:83-93`:
```js
await supabase.auth.signUp({ email, password, options: {
  data: { full_name: name, role: role, is_dev: isDev }
}});
```

`options.data` se guarda en `auth.users.raw_user_meta_data` (alias `user_metadata`). En Supabase **el usuario controla su propio `user_metadata`** vía `supabase.auth.updateUser({ data: { role: 'admin' } })`. No hace falta saber ningún código: cualquier usuario autenticado puede auto-elevarse.

Los 6 sitios donde se lee `user_metadata.role` para decidir `isAdmin` son por tanto fiables sólo si:
- (a) las **RLS policies** del backend NO confían en `user_metadata.role` para autorizar
- (b) se usa `app_metadata.role` (que SÍ es server-only) en su lugar
- (c) o hay una tabla `admins` separada y el front sólo la lee.

**Acción urgente:** auditar las policies de Supabase. Si una sola usa `auth.jwt() ->> 'user_metadata' ->> 'role'`, es vulnerable. Migrar a `app_metadata` o a una tabla `user_roles` poblada server-side.

### 2.3 Comprobaciones de seguridad sólo client-side

`hooks/match/useMatchActions.ts:34-38`:
```js
if (cancellationDeadline?.isPast && !isAdmin) {
  showAlert('Aviso', `No puedes desapuntarte si faltan menos de ${...}h…`);
  return;
}
await leaveMatch(...);
```

La regla "no se puede desapuntar pasado el deadline" se aplica en el cliente. Un usuario malicioso llama directamente a `supabase.from('match_participants').delete()…` y se salta la regla. Lo mismo aplica para:
- Borrar participantes (`removeParticipant`, `removeDummyPlayer`)
- Crear/editar/borrar partidos
- Inscribirse pasada la fecha

**Mitigación:** RLS policies + triggers que validen `now() < cancellation_deadline` server-side.

### 2.4 PHP endpoint de email sin autenticación visible

`lib/services/notificationService.ts:16`:
```js
const response = await fetch('https://multigraf.info/send_match_update.php', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: match.creator_email, type, playerName, … })
});
```

- El endpoint acepta `to` como un email arbitrario (lo lee de la BD pero el cliente lo envía).
- No vemos auth header. Si no requiere un token en el PHP, **cualquiera puede usarlo como relay de spam** apuntando a cualquier email.

**Acción:** auditar `send_match_update.php`. Idealmente mover a Supabase Edge Function con check de RLS + rate limiting + autenticación.

### 2.5 Códigos hardcoded en commit/repo

```
ADMINKKZ2026  KZ2026  DEV_ADMIN  DEV_PART
```

Aunque sustituidos por server-side validation, el historial git ya los contiene. Habría que cambiarlos (rotarlos) en BD/policies para que dejen de ser válidos.

### 2.6 No hay `.env.example`

El README dice "crea un `.env` con `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`". No hay `.env.example` ni se documenta `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` que también se usa (`app/admin/crear-partido.tsx:14`). El `EXPO_PUBLIC_` prefix indica que estas variables van al bundle (correcto para anon key + Maps API key con restricciones de dominio, pero confirmar que la Maps key SÍ tiene restricciones).

### 2.7 Datos de usuarios en el repo

`admin_players_import.csv` está en la raíz. Sin verlo asumo nombres/teléfonos de personas reales. Debería estar en `.gitignore`.

---

## 3. Duplicación masiva `app/dev/`

### 3.1 Estado actual

| Archivo dev | LOC | ¿Re-export limpio? | Diff vs prod |
|---|---|---|---|
| `app/dev/match/[id].tsx` | 2 | ✓ Sí | 9 |
| `app/dev/admin/jugadores.tsx` | 2 | ✓ Sí | 246 |
| `app/dev/admin/crear-partido.tsx` | 769 | ✗ Copia | 773 |
| `app/dev/(tabs)/index.tsx` | 940 | ✗ Copia divergente | 1439 |
| `app/dev/(tabs)/explore.tsx` | 132 | ✗ Copia | 235 |
| `app/dev/(tabs)/_layout.tsx` | 46 | ✗ Copia | 62 |

Tres archivos siguen el patrón correcto (2 LOC re-exportando el componente prod, que internamente decide qué tabla usar vía `useEnv().fromTable`).

**Pero `app/dev/(tabs)/index.tsx` tiene 940 LOC y diverge en 1,439 líneas del prod de 1585.** Quiere decir que en algún momento alguien tocó manualmente la versión dev y NO sincronizó con la prod (o viceversa). Esto es deuda técnica seria: dos versiones de la home screen mantenidas a mano.

### 3.2 Acción recomendada

Convertir TODOS los archivos `dev/*` que no sean ya re-export en re-exports de la versión prod. Por ejemplo:

```tsx
// app/dev/(tabs)/index.tsx
import IndexScreen from '../../(tabs)';
export default IndexScreen;
```

La diferencia prod/dev queda **completamente delegada al hook `useEnv()`** que ya está pensado para eso (`fromTable('matches')` → `matches_dev`).

Si hay diferencias de UI específicas para dev (botones extra, etc.), exponerlas con un flag dentro del componente prod:
```tsx
const { isDev } = useEnv();
return <View>{isDev && <DevToolbar />} … </View>
```

**Reducción estimada**: ~3,000 LOC.

---

## 4. Sin tipos de Supabase

`supabase_types.ts` = 1 byte. No se ha corrido el generador de tipos:
```bash
npx supabase gen types typescript --project-id <ref> > supabase_types.ts
```

Resultado: todas las queries devuelven `any`. Una sola columna mal escrita (`max_player` en vez de `max_players`) no salta en compile time.

Esto se nota en patrones como:
```ts
const [match, setMatch] = useState<any>(null);
const [participantsList, setParticipantsList] = useState<any[]>([]);
```

(`hooks/match/useMatch.ts:9-10`).

**Acción:** regenerar tipos y reemplazar los `any` por `Database['public']['Tables']['matches']['Row']` y similares. Incremental — cada archivo que se toque, tipar.

---

## 5. Componentes monolíticos

### 5.1 `app/(tabs)/index.tsx` — 1585 LOC

La home contiene:
- `MatchCard` (sub-componente inline)
- Lógica del calendario (LocaleConfig + selección + filtros)
- Fetch + filtrado de partidos
- Share múltiple
- Refresh control
- Modos admin/no-admin con duplicación inline

**Refactor sugerido:**
1. Extraer `MatchCard` a `components/match/MatchCard.tsx` (~150 LOC).
2. Extraer el calendar bar a `components/MatchCalendarBar.tsx`.
3. Mover la lógica de `fetchMatches`, role-check, refresh, etc. a un hook `useMatchList()`.
4. `(tabs)/index.tsx` debería quedar como ~200 LOC de composición.

### 5.2 `app/admin/crear-partido.tsx` — 769 LOC

Wizard de creación/edición con 3 modales (date, time, location), validación, image picker, switches de categoría.

**Refactor sugerido:**
- Extraer modales: `<DatePickerModal>`, `<TimePickerModal>`, `<LocationPickerModal>`.
- Mover `fetchLocations`, `saveLocation`, `submit` a un hook `useCreateMatchForm()`.
- Validación en `lib/validators/match.ts`.

### 5.3 `lib/services/` está infrautilizado

Sólo 3 archivos pequeños (95 LOC total). Mucha lógica de Supabase vive directamente en componentes (`app/(tabs)/index.tsx` hace `supabase.from(...).select()` en línea). Migrar más queries a `lib/services/` da consistencia y permite mockear para tests futuros.

---

## 6. Scripts dev en raíz

Igual que NexusHub, hay basura en la raíz que debería estar en `scripts/dev/`:

```
admin_players_import.csv          ⚠️ Datos personales — debería estar en .gitignore
create_matches_from_image.js
create_requested_matches.js
create_users.js
debug_dev.js
debug_match.js
download_images.js
get_venues.js
query_db.js
query_db_schema.js
query_db_users.js
query_db_venues.js
test_filter.js
```

13 ficheros + CSV. Action: mover a `scripts/dev/` y añadir `*.csv` con datos personales a `.gitignore`.

---

## 7. Base de datos

### 7.1 Schema inferido (sin tipos generados)

Tablas usadas en el código:
- `matches` / `matches_dev` — title, venue, location_url, date, time, price, max_players, joined_players, level, distance (formato 5v5), is_female, is_mixed, is_private, is_advanced, cancellation_hours, creator_email, venue_image_url, …
- `match_participants` / `match_participants_dev` — match_id, user_id (nullable for guests), user_name
- `saved_locations` / `saved_locations_dev` — name, location_url, image_url
- `admin_players` / `admin_players_dev` — name, level, phone

### 7.2 Anti-patterns observados

- `deleteMatchTransaction` no es transaccional (`matchService.ts:20-24`). Dos `await` consecutivos sin BEGIN/COMMIT. Si el segundo falla → orfanos en `match_participants`.
- `joined_players` se mantiene a mano (`updateMatchJoinedPlayers`) en lugar de calcularse con un COUNT o trigger. Riesgo de desincronización.
- Hay un `computed_joined` mencionado en `(tabs)/index.tsx:74` — sugiere que la suma se hace en JS. Si la BD tiene una view, mejor.
- `max_players - joined_players - participantsList.length` en `useMatch.ts:52`: combina contador BD + array de participantes — confuso. Una de las dos fuentes sobra.

### 7.3 Recomendación

- Definir un Postgres RPC `delete_match(match_id)` con transacción.
- Reemplazar `joined_players` por una computed column / view (`SELECT COUNT(*) FROM match_participants WHERE match_id = …`).
- Usar `JOIN` server-side para devolver `available_spots` directamente.

---

## 8. UX / Frontend issues

### 8.1 i18n incompleto

Strings hardcoded en español en muchos sitios:
- `useMatchActions.ts:35`: `'Aviso'`, `'No puedes desapuntarte…'`
- `crear-partido.tsx`: labels y placeholders parcialmente sin `t()`
- `notificationService.ts`: subjects de email
- Múltiples `Alert.alert('Error', ...)` sin pasar por `t()`

### 8.2 `console.log` activos

20 sitios. Mínimamente:
- `useMatch.ts:42` `console.log('Error fetching match data:', err)`
- `notificationService.ts:33,35` logs de notificación
- `(tabs)/index.tsx:522` `console.error('Error getting user for role check:', error)`
- `lib/share.ts` (sin contar)

**Acción:** wrapper `logger.ts` con flag `__DEV__` o reemplazar por toasts no intrusivos.

### 8.3 `Alert.alert` web fallback

`useMatchActions.ts:21-24`:
```ts
const showAlert = (title, msg) => {
  if (Platform.OS === 'web') window.alert(`${title}: ${msg}`);
  else Alert.alert(title, msg);
};
```

OK como solución temporal. A largo plazo, un `<Toast>` propio multiplataforma daría UX consistente.

### 8.4 Carga de role en cada pantalla

Cada componente que necesita saber `isAdmin` hace su propio `supabase.auth.getUser()` y lee `user_metadata.role`. 4+ duplicaciones (`useMatch.ts`, `_layout.tsx`, `(tabs)/index.tsx`, `app/dev/(tabs)/index.tsx`).

**Refactor:** un hook `useAuth()` o un `AuthContext` que exponga `{ user, isAdmin, isDev }`.

---

## 9. Tests

**Cero tests** en todo el proyecto. Ni `*.test.*` ni `*.spec.*` ni configuración de Vitest/Jest.

Dado que es una app móvil con lógica complicada (deadlines, permisos, parsing de fechas en es/en/ca, share URLs), los candidatos naturales son:

- `lib/date.ts`: `parseMatchDate`, `toISODate`, `formatLocalizedDate` (puramente funcionales — fáciles).
- `lib/share.ts`: `validatePassword`, `getBaseUrl` (puras).
- `hooks/match/useMatch.ts`: las derivaciones (`isFull`, `isStarted`, `cancellationDeadline`) son testeables con mocks de fecha.
- `lib/services/*`: integración con Supabase mockeado.

Setup mínimo recomendado: Jest + `@testing-library/react-native` (Expo lo soporta out of the box).

---

## 10. Dependencias

Stack moderno y razonable:
- Expo 54 (última), React 19.1, React Native 0.81.5
- Expo Router 6
- Supabase JS 2.100
- i18next + react-i18next
- React Navigation 7
- Google Maps via `@react-google-maps/api` (web) + `react-native-maps` (native)
- Reanimated 4
- ftp-deploy para deploy web (raro pero funcional)

No detecto deps obvias innecesarias. `dotenv` está como dependency pero Expo + `EXPO_PUBLIC_*` debería ser suficiente sin él — confirmar uso.

**Acción:** `npm audit` después de `npm install` por si hay CVEs.

---

## 11. Web build (Multigraf hosting)

Pistas detectadas:
- `app/_layout.tsx:105`: `<link rel="canonical" href="https://multigraf.info/Kickerzbcn/${segments.join('/')}">` → publicación bajo subdir.
- `lib/share.ts` y `notificationService.ts` apuntan a `https://multigraf.info/Kickerzbcn/`.
- `eas.json` + `package.json` `deploy: node scripts/deploy.js` + dep `ftp-deploy` → deploy probablemente vía FTP a multigraf.

**Riesgos:**
- Credenciales FTP en `scripts/deploy.js` — comprobar que NO están en el repo en plano.

---

## 12. Acción priorizada (lo que haría AHORA)

### 🔥 Esta semana (crítico, no se puede esperar)

1. **Auditar RLS policies de Supabase** y verificar que NO confían en `user_metadata.role`. Si lo hacen, migrar a `app_metadata` (server-only) o a una tabla `user_roles`. (1-2 días con tests manuales).
2. **Mover validación de invite codes a Edge Function**. Bloquear `signUp` con role en `user_metadata` desde el cliente. Rotar `ADMINKKZ2026` (ya quemado en bundles antiguos). (1 día).
3. **Auditar `send_match_update.php`** — añadir token/auth en el header y rate-limit. (medio día).
4. **`admin_players_import.csv` fuera del repo** + `.gitignore` para `*.csv`. Si ya se pusheó con datos reales: borrar del historial con `git filter-repo`. (2 horas).

### 📋 Próximo sprint

5. **Generar tipos Supabase** (`npx supabase gen types ...`) y reemplazar `any` poco a poco.
6. **Consolidar duplicación `app/dev/`** a re-exports. -3,000 LOC. (medio día).
7. **Mover scripts dev** a `scripts/dev/` y arreglar paths. (1 hora).
8. **Hook `useAuth()`** que centralice user + isAdmin + isDev. Eliminar las 4 duplicaciones. (medio día).
9. **Convertir `deleteMatchTransaction` a un RPC** con transacción Postgres. (2 horas).

### 🛠️ Roadmap medio plazo

10. **Partir `app/(tabs)/index.tsx`** en `MatchCard` + `MatchCalendarBar` + `useMatchList()`. (1 día).
11. **Partir `crear-partido.tsx`** en modales + `useCreateMatchForm()`. (1 día).
12. **Constante `APP_BASE_URL`** que reemplace los 4 hardcoded de `multigraf.info/Kickerzbcn`. (15 min).
13. **Tests iniciales** para `lib/date.ts`, `lib/share.ts`, `useMatch` deadlines. (1 día setup + tests).
14. **Reemplazar `joined_players` por COUNT/view**, eliminar la sincronización manual.
15. **i18n cobertura completa** — recorrer `useMatchActions.ts` y demás archivos con strings ES hardcodeados.

---

## Anexo — métricas

| Métrica | Valor |
|---|---|
| LOC totales (sin node_modules) | ~6,250 |
| Archivos TSX/TS | 47 |
| Archivos en `app/` (rutas) | 21 |
| Componentes en `components/` | 14 |
| Hooks custom | 5 |
| Servicios Supabase | 3 archivos / 95 LOC |
| Idiomas i18n | 3 (es, en, ca) |
| Tests | 0 |
| Líneas duplicadas `app/dev/` ↔ `app/` | ~2,800 |
| Scripts dev en raíz | 13 + 1 CSV |
| `console.log/error/warn` activos | 20 |
| URLs hardcoded a `multigraf.info` | 4 |
| `user_metadata.role` reads | 6 sitios |
