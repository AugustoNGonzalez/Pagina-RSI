# Comparador RSI

Aplicación web para comparar el RSI de múltiples acciones, con matriz de
ratios entre pares. Corre en red local: el servidor vive en la PC de
Augusto Nicolás y se accede desde el navegador de cualquier equipo de la
casa.

---

# Parte 1 — Cómo se usa

## Abrir la aplicación

Doble click en el acceso directo **Comparador RSI**, o entrar a
`http://DESKTOP-VGNU8JR:3000` desde el navegador.

Requisito: la PC de Augusto tiene que estar prendida. El servidor arranca
solo al encenderla, no hay que hacer nada más. Si aparece un cartel rojo
que dice que no se pudo conectar, la máquina está apagada o suspendida.

## Qué muestra la pantalla

**La tabla de arriba**: una fila por acción, con su precio actual, cuánto
subió o bajó respecto del cierre anterior, y su RSI 14. La celda del RSI
se colorea sola: cuanto más roja, más sobrecomprada; cuanto más verde,
más sobrevendida. Si el RSI pasa de 70 o baja de 30, se resalta la fila
entera.

Se puede ordenar por cualquier columna haciendo click en su título. Un
click ordena de menor a mayor, otro al revés, y un tercero vuelve al
orden alfabético.

**La matriz de abajo**: cruza todas las acciones de la tabla entre sí.
Cada celda es el RSI del par fila/columna — el mismo número que muestra
TradingView si se escribe, por ejemplo, `AAPL/MSFT`. Sirve para ver qué
acción viene fuerte contra cuál. Los colores siguen la misma lógica que
la tabla. Pasando el mouse por una celda aparece el detalle del cálculo.

Importante: la matriz **no** es simétrica. `AAPL/MSFT` y `MSFT/AAPL` son
dos números distintos, no uno el opuesto del otro, así que las dos
mitades del cuadro dicen cosas diferentes.

## Los botones del panel izquierdo

**Agregar acción**: se escribe el símbolo (`AAPL`) y se aprieta Agregar.
Se pueden poner varios de una vez separados por coma: `AAPL, MSFT, NVDA`.
Si la acción es nueva, tarda unos segundos porque baja cinco años de
histórico; si ya estaba cargada, aparece al instante.

También acepta un par con barra: escribir `AAPL/MSFT` limpia la tabla y
deja solo esas dos, para compararlas a solas.

**Grupos**: el desplegable carga de una vez un conjunto de acciones
guardado (por ejemplo "Semiconductores"). Se elige y la tabla se arma
sola. Para armar uno nuevo está *Crear grupo nuevo*, ahí se le pone
nombre y la lista de símbolos.

**Actualizar**: vuelve a pedir los datos frescos de todas las acciones
que estén en la tabla, de a una por vez. Con muchas acciones tarda unos
segundos; abajo aparece un cartelito con el avance.

**Agregar todas**: pone en la tabla todas las acciones cargadas en el
sistema.

**Limpiar vista**: vacía la tabla. Las acciones **no se borran**, siguen
guardadas; se pueden volver a traer con Agregar todas o escribiendo el
símbolo.

**La ✕ de cada fila**: saca esa acción de la tabla (pide confirmación).
Tampoco la borra del sistema.

**El ↻ de cada fila**: actualiza solo esa acción. Aparece al pasar el
mouse por la fila, donde normalmente está la hora de última
actualización.

**La flecha ‹ del borde**: esconde el panel izquierdo para ganar
pantalla. Se vuelve a abrir con ›.

## El engranaje (abajo a la izquierda)

Abre las opciones:

- **Modo claro / oscuro**.
- **Eliminar acción**: esta sí borra la acción del sistema y su historial
  guardado. Se puede volver a agregar cuando se quiera; se vuelve a bajar
  todo de internet.
- **Grupos**: renombrar, eliminar, y agregar o quitar acciones de un
  grupo existente.
- **Vaciar base de datos**: borra todo. No se puede deshacer.

## Cosas que conviene saber

**Los precios se actualizan solos** cada 12 minutos, mientras el mercado
de Nueva York está abierto (de 10:30 a 17:00, hora argentina). Fuera de
ese horario los números quedan quietos, que es lo correcto: no hay
operaciones.

**Los números coinciden con TradingView**, tanto el RSI de cada acción
como el de los pares. Está verificado al centésimo.

**Si algo tarda, está trabajando, no colgado.** Agregar una acción nueva
o actualizar muchas juntas lleva segundos porque está trayendo datos
reales de internet en ese momento.

**Los símbolos son los de Yahoo Finance.** Para acciones de Estados
Unidos alcanza el ticker pelado (`AAPL`, `KO`). Para otros mercados hay
que agregar el sufijo: `.BA` para Buenos Aires, `.L` para Londres, `.SA`
para Brasil. Ante la duda, buscar la empresa en finance.yahoo.com y usar
el símbolo que aparece ahí. No se puede buscar por nombre todavía:
escribir "Tesla" no funciona, hay que poner `TSLA`.

**Cada uno tiene su propia vista.** Qué acciones se ven y el modo
claro/oscuro se guardan en cada navegador, así que Augusto puede estar
mirando otra cosa sin molestar. Las acciones cargadas y los grupos, en
cambio, son compartidos.

**Si la app deja de responder** y la PC de Augusto está prendida,
avisale: se arregla reiniciando el servidor desde ahí.
Para reiniciarlo a mano (si la app deja de responder), hay un acceso
directo **reset-server.bat** en el escritorio, que corre esos dos
comandos como administrador:

```powershell
schtasks /end /tn "Servidor RSI"
schtasks /run /tn "Servidor RSI"
```

Si eso no alcanza, matar el proceso y volver a lanzarlo:

```powershell
Get-Process node | Stop-Process -Force
schtasks /run /tn "Servidor RSI"
```


---

# Parte 2 — Documentación técnica

## Stack

- **Backend**: Node.js + Express (ES modules), `mssql`, `yahoo-finance2`
- **Base**: SQL Server (instancia local)
- **Frontend**: HTML/CSS/JS sin frameworks ni build step (módulos ES
  nativos, servidos por el mismo Express)

## Estructura
Pagina_RSI/
├── README.md
├── Frontend/
│ ├── index.html
│ ├── css/styles.css
│ └── js/
│   ├── app.js orquestador: estado + wiring
│   ├── config.js constantes de la app
│   ├── Client/apiClient.js única capa que habla con la API
│   └── UI/
│       ├── tableUI.js tabla principal
│       ├── matrixUI.js matriz de ratios
│       ├── format.js escape, formatos y gradientes
│       ├── notify.js toasts, overlay, progreso
│       └── theme.js tema y aside colapsable
└── Backend/
    ├── server.js entry point y rutas
    ├── smokeTest.js batería de tests contra la API
    ├── .env credenciales (NO se commitea)
    ├── Controllers/
    │   ├── stocksController.js
    │   └── groupController.js
    ├── Database/
    │   ├── connection.js pool singleton, conexión lazy
    │   ├── queries.js todas las queries parametrizadas
    │   └── schema.sql DDL (dropea y recrea)
    └── Services/
        ├── marketDataService.js Yahoo Finance + retry/backoff
        ├── priceService.js persistencia de velas y cotización
        ├── rsiService.js cálculo puro del RSI (Wilder)
        ├── rsiPersistenceService.js
        ├── ratioService.js matriz de RSI de ratios
        ├── stockService.js alta/búsqueda de acciones
        ├── syncService.js orquestación del sync
        └── serviceConfig.js configuración por env vars

## Puesta en marcha desde cero

1. **SQL Server** con autenticación mixta habilitada, TCP/IP activo, y un
   login SQL con contraseña.
2. **Base**: correr `Backend/Database/schema.sql` en SSMS. Ojo, el script
   dropea las tablas antes de crearlas.
3. **`Backend/.env`**:

DB_USER=sa
DB_PASSWORD= Agusnico2831
DB_SERVER=localhost
DB_NAME=RSI_Project

4. **Dependencias**: `npm install` en `Backend/`.
5. **Arrancar**: `node server.js` desde `Backend/`. La app queda en
   `http://localhost:3000`.

Variables opcionales del `.env` (defaults entre paréntesis): `PORT`
(3000), `RSI_PERIOD` (14), `HISTORY_YEARS` (5), `UPDATE_WINDOW_DAYS`
(400), `GAP_MARGIN_DAYS` (10), `RATE_LIMIT_MS` (1200), `MAX_RETRIES` (5).

## Acceso desde otra PC de la red

- Regla de firewall entrante para el puerto 3000, perfil **privado**.
- La red de Windows tiene que estar clasificada como privada
  (`Get-NetConnectionProfile` → `NetworkCategory: Private`).
- La otra PC entra a `http://DESKTOP-VGNU8JR:3000`.

## Arranque automático

Tarea programada **"Servidor RSI"**, disparada al iniciar el sistema,
corriendo como SYSTEM, que ejecuta `Backend/start-server.bat`. El log
queda en `Backend/server.log`.

Durante el desarrollo conviene bajarla para liberar el puerto:

```powershell
schtasks /end /tn "Servidor RSI"     # detener
schtasks /run /tn "Servidor RSI"     # volver a levantar
```

Si el server parece ignorar cambios recién editados, casi siempre es que
está corriendo la instancia vieja de la tarea.

## Tests

`node smokeTest.js` con el server levantado. Cubre los 12 endpoints y es
**no destructivo**: solo borra lo que él mismo crea.

Verificaciones que el script no hace y conviene repetir a mano:

```sql
-- Ninguna acción puede tener dos velas del mismo día.
-- Si esto devuelve filas, se coló la vela en curso.
SELECT StockId, CAST(PriceDate AS DATE) AS Dia, COUNT(*) AS Filas
FROM StockPrices
GROUP BY StockId, CAST(PriceDate AS DATE)
HAVING COUNT(*) > 1;
```

Y comparar contra TradingView: RSI 14 diario de una acción, y el RSI del
símbolo compuesto (`AAPL/MSFT`) contra la celda correspondiente.

## Decisiones de diseño

Las cuatro que explican por qué el código es como es:

**RSI de Wilder, recalculado completo.** El suavizado es recursivo: cada
promedio depende del anterior desde el origen de la serie, así que no se
puede calcular sobre una ventana parcial sin romper el empalme. En cada
sync se recalcula toda la serie desde la base (milisegundos) y se
persiste solo lo nuevo. La alternativa —guardar el estado del suavizado—
sería más rápida y mucho más frágil.

**La vela en curso nunca se persiste.** Durante la rueda, Yahoo devuelve
la vela del día con un epoch inestable que cambia entre fetches; guardarla
generaría filas duplicadas del mismo día. Vive solo en memoria: alimenta
el RSI vivo que viaja en la respuesta del sync, y se persiste recién al
día siguiente, ya cerrada y con su epoch definitivo.

**La matriz de ratios no es simétrica.** RSI(B/A) no es 100 − RSI(A/B):
la inversa 1/x deforma los deltas de forma no lineal. Por eso se calcula
el RSI de las dos direcciones. Lo que sí se comparte es la intersección
de fechas, que es la parte cara.

**Ventana adaptativa de descarga.** Una acción nueva baja `HISTORY_YEARS`
de histórico; una actualización pide solo lo necesario para cubrir el
hueco más el colchón que Wilder necesita para converger
(`UPDATE_WINDOW_DAYS`). Bajar cinco años cada doce minutos sería
desperdicio.

## Estado y pendientes

Funcionando: catálogo de acciones con histórico diario, RSI 14 por
acción, matriz de ratios entre pares, grupos editables, auto-refresh
intradía, temas claro/oscuro, panel de opciones.

Pendiente, en orden aproximado de prioridad:

1. **RSI semanal y horario** en la tabla. El semanal se deriva de los
   datos que ya están guardados (el cierre semanal es el último cierre
   diario de la semana). El horario necesita fetch propio y agregar
   `Interval` a las PK de `StockPrices` y `StockRSI` — buen momento para
   generalizar el schema de cara a los indicadores que vienen.
2. **Heikin Ashi**. Se calcula desde el OHLC, que ya se guarda completo.
   No se busca el gráfico sino el valor que da.
3. **Cinco indicadores y consenso**: el objetivo final. La idea es que de
   los cinco salga una señal agregada sobre la cual decidir.
4. **Búsqueda por nombre** ("Tesla" → TSLA). Requiere el endpoint de
   búsqueda de Yahoo y una UI de sugerencias.

## Notas

Proyecto personal, uso doméstico. La instancia de SQL Server usada es
Developer Edition, que no está licenciada para producción; para cualquier
uso comercial habría que pasar a Express (gratis, límite de 10 GB por
base — de sobra para este volumen).