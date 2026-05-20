# Guía de Funcionalidades - AmicSport

Esta guía detalla las herramientas disponibles para los administradores de AmicSport para la gestión eficiente de partidos de fútbol.

---

## 1. Gestión de Partidos

Desde el panel de administración, puedes gestionar el ciclo de vida completo de un evento deportivo.

### Crear un Partido
1. Accede a **"Agendar Partido"**.
2. Completa los campos obligatorios: **Título, Recinto, Fecha y Hora**.
3. El sistema autocompletará el enlace de Google Maps basándose en el nombre del recinto si no proporcionas uno.

### Editar y Duplicar
*   **Editar**: Pulsa el icono de lápiz en cualquier partido de la lista principal para modificar sus detalles.
*   **Duplicar**: Mantén pulsado un partido o usa la opción de duplicar para crear una copia rápida (útil para partidos recurrentes).

---

## 2. Gestión de Ubicaciones Globales

El sistema permite reutilizar recintos para ahorrar tiempo y asegurar geolocalización precisa.

### Guardar Ubicaciones
Al lado del campo "Ubicación del recinto" encontrarás dos botones:
*   💾 **Guardar**: Guarda el nombre y el enlace de Google Maps actual en la base de datos global.
*   📋 **Listar**: Abre un selector con todas las ubicaciones guardadas. Al seleccionar una, se rellenan automáticamente todos los campos.

### Administrar Recintos
En el selector de ubicaciones, puedes eliminar recintos antiguos o incorrectos usando el icono de **papelera** 🗑️.

---

## 3. Directorio de Jugadores (Agenda)

Permite registrar jugadores manualmente sin que estos tengan que realizar el proceso de login, ideal para invitados recurrentes.

*   **Registro**: Añade nombre, nivel de juego y número de teléfono.
*   **Asociación**: Puedes inscribir a estos jugadores directamente en los partidos desde la vista de detalles.

---

## 4. Visualización y Filtros

### Mapa Interactivo
La pestaña **"Explorar"** muestra todos los partidos en un mapa de Google.
*   **Colores de Marcador**:
    *   🟢 **Verde**: >75% de plazas disponibles.
    *   🟡 **Amarillo**: <25% de plazas disponibles.
    *   🔴 **Rojo**: Partido lleno.
*   **Filtro de Recinto**: Usa el desplegable de filtros para ver solo los partidos de un club o polideportivo específico.

### Filtro de Calendario
En la pantalla principal, selecciona un día específico en el calendario superior para filtrar los partidos de esa fecha.
