# Comparador RSI

Aplicación web para comparar indicadores técnicos entre múltiples
acciones, con matriz de ratios entre pares y tres plazos (1 hora, diario,
semanal). Corre en red local: el servidor vive en la PC de Augusto
Nicolás y se accede desde el navegador de cualquier equipo de la casa.

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

**Plazo (1H / 1D / 1S)**: cambia la escala de tiempo de los cálculos.
Afecta a la tabla y a la matriz al mismo tiempo. Cambiar de plazo es
instantáneo: los datos ya están guardados.

**Agregar acción**: se escribe el símbolo (`AAPL`) y se aprieta Agregar.
Se pueden poner varios de una vez separados por coma: `AAPL, MSFT, NVDA`.
Si la acción es nueva, tarda unos segundos porque baja su histórico; si
ya estaba cargada, aparece al instante.

También acepta un par con barra: escribir `AAPL/MSFT` limpia la tabla y
deja solo esas dos, para compararlas a solas.

**Actualizar**: vuelve a pedir los datos frescos de todas las acciones
que estén en la tabla, de a una por vez. Con muchas acciones tarda unos
segundos; abajo aparece un cartelito con el avance.

**Agregar todas**: pone en la tabla todas las acciones cargadas en el
sistema.

**Limpiar vista**: vacía la tabla. Las acciones **no se borran**, siguen
guardadas; se pueden volver a traer con Agregar todas o escribiendo el
símbolo.

**Grupos**: el desplegable carga de una vez un conjunto de acciones
guardado (por ejemplo "Semiconductores"). Se elige y la tabla se arma
sola. Para armar uno nuevo está *Crear grupo nuevo*, ahí se le pone
nombre y la lista de símbolos.

**La ✕ de cada fila**: saca esa acción de la tabla (pide confirmación).
No la borra del sistema.

**El ↻ de cada fila**: actualiza solo esa acción. Aparece al pasar el
mouse por la fila, donde normalmente está la hora de última
actualización.

**La flecha del borde**: esconde el panel izquierdo para ganar pantalla.

**Abajo del panel**: el engranaje abre las opciones, y la luna/sol
cambia entre modo claro y oscuro.

## El engranaje (opciones)

- **Eliminar acción**: esta sí borra la acción del sistema y su historial
  guardado. Se puede volver a agregar cuando se quiera; se vuelve a bajar
  todo de internet.
- **Grupos**: renombrar, eliminar, y agregar o quitar acciones de un
  grupo existente.
- **Vaciar base de datos**: borra todo. No se puede deshacer.

## Cosas que conviene saber

**Los precios se actualizan solos** al cruzar cada hora en punto,
mientras el mercado de Nueva York está abierto. Se actualiza ahí y no
cada tantos minutos porque es cuando cierra una vela horaria: en el medio
cambiaría el precio pero no los indicadores, que es lo que se mira.

El horario del mercado es de 9:30 a 16:00 de Nueva York, o sea 10:30 a
17:00 en Argentina entre marzo y noviembre, y 11:30 a 18:30 el resto del
año (allá cambian la hora, acá no). Fuera de ese rango los números quedan
quietos, que es lo correcto: no hay operaciones.

**Los números coinciden con TradingView** en los tres plazos, tanto el
RSI de cada acción como el de los pares. Está verificado al centésimo.
(Al comparar, tener en cuenta que el gráfico de TradingView esté en velas
normales y sesión regular: con velas Heikin Ashi o con horario extendido
los números son otros.)

**Si algo tarda, está trabajando, no colgado.** Agregar una acción nueva
o actualizar muchas juntas lleva segundos porque está trayendo datos
reales de internet en ese momento.

**Los símbolos son los de Yahoo Finance.** Para acciones de Estados
Unidos alcanza el ticker pelado (`AAPL`, `KO`). Para otros mercados hay
que agregar el sufijo: `.BA` para Buenos Aires, `.L` para Londres, `.SA`
para Brasil. Ante la duda, buscar la empresa en finance.yahoo.com y usar
el símbolo que aparece ahí. No se puede buscar por nombre todavía:
escribir "Tesla" no funciona, hay que poner `TSLA`.

**Cada uno tiene su propia vista.** Qué acciones se ven, el plazo elegido
y el modo claro/oscuro se guardan en cada navegador, así que Augusto
puede estar mirando otra cosa sin molestar. Las acciones cargadas y los
grupos, en cambio, son compartidos.

**Si la app deja de responder** y la PC de Augusto está prendida,
avisale: se arregla reiniciando el servidor desde ahí.

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
│ ├── app.js arranque y wiring (mínimo)
│ ├── state.js estado + suscripción
│ ├── config.js constantes de la app
│ ├── Client/apiClient.js única capa que habla con la API
│ ├── actions/
│ │ ├── stocks.js agregar, sincronizar, mostrar/ocultar
│ │ ├── groups.js ver y crear grupos
│ │ ├── indicators.js recarga de valores calculados
│ │ └── autoRefresh.js temporizador + horario de mercado
│ └── UI/
│ ├── tableUI.js tabla principal (columnas dinámicas)
│ ├── matrixUI.js matriz de ratios
│ ├── settingsUI.js panel de opciones
│ ├── format.js escape, formatos y gradientes
│ ├── notify.js toasts, overlay, progreso
│ └── theme.js tema y aside colapsable
└── Backend/
├── server.js entry point y rutas
├── smokeTest.js batería de tests contra la API
├── .env credenciales (NO se commitea)
├── Controllers/
│ ├── stocksController.js CRUD de acciones
│ ├── indicatorsController.js cálculos
│ └── groupController.js
├── Database/
│ ├── connection.js pool singleton, conexión lazy
│ ├── queries.js todas las queries parametrizadas
│ └── schema.sql DDL (dropea y recrea)
└── Services/
├── marketDataService.js Yahoo Finance + retry/backoff
├── priceService.js persistencia y lectura de velas
├── indicatorService.js registro de indicadores
├── rsiService.js cálculo puro del RSI (Wilder)
├── ratioService.js matriz sobre pares A/B
├── timeframeService.js agregación a otros plazos
├── stockService.js alta/búsqueda de acciones
├── syncService.js orquestación del sync
└── serviceConfig.js configuración por env vars

## Puesta en marcha desde cero

1. **SQL Server** con autenticación mixta habilitada, TCP/IP activo, y un
   login SQL con contraseña.
2. **Base**: correr `Backend/Database/schema.sql` en SSMS. Ojo, el script
   dropea las tablas antes de crearlas.
3. **`Backend/.env`** (no se commitea; los valores son de ejemplo):
DB_USER=sa
DB_PASSWORD=<la contraseña del login SQL>
DB_SERVER=localhost
DB_NAME=RSI_Project
4. **Dependencias**: `npm install` en `Backend/`.
5. **Arrancar**: `node server.js` desde `Backend/`. La app queda en
   `http://localhost:3000`.

Variables opcionales del `.env` (defaults entre paréntesis): `PORT`
(3000), `RSI_PERIOD` (14), `HISTORY_YEARS` (5), `HOURLY_HISTORY_DAYS`
(250), `GAP_MARGIN_DAYS` (10), `RATE_LIMIT_MS` (1200), `MAX_RETRIES` (5),
`CORS_ORIGINS` (vacío).

`CORS_ORIGINS` sólo hace falta si alguna vez se sirve el frontend desde
otro puerto durante el desarrollo. Vacío, la API no emite headers de CORS
y sólo la acepta el navegador que cargó la página desde este mismo
servidor — que es el caso normal, también desde las otras PCs de la red.

## API
GET /api/stocks listado con última cotización
POST /api/stocks alta o sync { symbol, interval }
DELETE /api/stocks/:id borra acción y su historial
DELETE /api/data vacía la base

GET /api/indicators/meta qué indicadores existen y su escala
POST /api/indicators valores por símbolo y plazo
POST /api/indicators/ratio-matrix matriz N×N sobre pares

GET /api/groups listado con cantidad de miembros
GET /api/groups/:id grupo con sus miembros
POST /api/groups crear (sincroniza los símbolos)
PATCH /api/groups/:id renombrar
DELETE /api/groups/:id borrar (no borra las acciones)
POST /api/groups/:id/stocks sumar acciones al grupo
DELETE /api/groups/:id/stocks/:stockId sacar una acción del grupo
## Acceso desde otra PC de la red

- Regla de firewall entrante para el puerto 3000, perfil **privado**.
- La red de Windows tiene que estar clasificada como privada
  (`Get-NetConnectionProfile` → `NetworkCategory: Private`).
- La otra PC entra a `http://DESKTOP-VGNU8JR:3000`.

## Arranque automático

Tarea programada **"Servidor RSI"**, disparada al iniciar el sistema,
corriendo como SYSTEM, que ejecuta `Backend/start-server.bat`. El log
queda en `Backend/server.log`.

Para reiniciarlo a mano (si la app deja de responder), hay un acceso
directo **Reiniciar servidor RSI** en el escritorio, que corre esos dos
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

Durante el desarrollo conviene bajar la tarea para liberar el puerto. Si
el server parece ignorar cambios recién editados, casi siempre es que
está corriendo la instancia vieja.

## Tests

`node smokeTest.js` con el server levantado. Cubre los 14 endpoints y es
**no destructivo**: solo borra lo que él mismo crea.

Verificaciones que el script no hace y conviene repetir a mano:

```sql
-- Ninguna acción puede tener dos velas del mismo período en el mismo
-- intervalo. Si esto devuelve filas, se coló la vela en curso.
SELECT StockId, [Interval], Epoch, COUNT(*) AS Filas
FROM StockPrices
GROUP BY StockId, [Interval], Epoch
HAVING COUNT(*) > 1;

-- Cuántas velas hay de cada intervalo
SELECT s.Symbol, p.[Interval], COUNT(*) AS Velas, MAX(p.PriceDate) AS Ultima
FROM Stocks s JOIN StockPrices p ON p.StockId = s.StockId
GROUP BY s.Symbol, p.[Interval]
ORDER BY s.Symbol, p.[Interval];
```

Y comparar contra TradingView en los tres plazos: el RSI 14 de una acción
y el del símbolo compuesto (`AAPL/MSFT`) contra la celda correspondiente.
El gráfico tiene que estar en **velas normales** (no Heikin Ashi) y
**sesión regular** (no horario extendido).

## Decisiones de diseño

Las cinco que explican por qué el código es como es:

**RSI de Wilder, recalculado completo.** El suavizado es recursivo: cada
promedio depende del anterior desde el origen de la serie, así que no se
puede calcular sobre una ventana parcial sin romper el resultado. La
serie se lee entera de la base en cada request; con miles de velas son
milisegundos.

**Los indicadores no se persisten.** Se calculan al vuelo desde las velas
guardadas. Persistirlos obligaría a una tabla por indicador y plazo, con
el riesgo permanente de que se desincronice de los precios, para ahorrar
un cálculo que ya es despreciable. El costo real está en la red, no en el
CPU.

**La vela en curso nunca se persiste.** Durante la rueda, Yahoo devuelve
la vela del período con un epoch inestable que cambia entre fetches;
guardarla generaría filas duplicadas. Vive solo en memoria: el frontend
manda el precio del momento en cada request de indicadores, y el backend
lo agrega como última vela sintética. Se persiste recién cuando el
período cierra y su epoch queda fijo.

**La matriz de ratios no es simétrica.** RSI(B/A) no es 100 − RSI(A/B):
la inversa 1/x deforma los deltas de forma no lineal. Por eso se calcula
el indicador en las dos direcciones. Lo que sí se comparte es la
intersección de fechas, que es la parte cara.

**Solo se guardan los intervalos que Yahoo entrega como velas reales**
(`1d` y `1h`). El semanal se deriva agrupando las diarias: el cierre
semanal ES el último cierre diario de la semana, así que persistirlo
sería guardar dos veces el mismo dato.

## Estado y pendientes

Funcionando: catálogo de acciones con histórico diario y horario, RSI 14
en los tres plazos, matriz de ratios entre pares, grupos editables,
auto-refresh intradía, temas claro/oscuro, panel de opciones.

Pendiente, en orden aproximado de prioridad:

1. **Heikin Ashi.** Es un tipo de vela, no un indicador suelto: la
   implementación natural es transformar la serie antes de calcular
   (mismo lugar que `applyTimeframe`), de modo que pueda alimentar a
   cualquier indicador. Falta definir con el usuario si lo quiere como
   valor propio o como modo que afecta a todo.
2. **Cinco indicadores y consenso**: el objetivo final. La idea es que de
   los cinco salga una señal agregada sobre la cual decidir. Agregar uno
   es escribir su función pura y sumar una entrada al registro de
   `indicatorService`; el frontend arma la columna solo a partir de la
   metadata.
3. **Selector de columnas** en el aside: qué indicadores mostrar. El
   estado y el render dinámico ya están listos; con un solo indicador no
   tiene sentido todavía.
4. **Búsqueda por nombre** ("Tesla" → TSLA). Requiere el endpoint de
   búsqueda de Yahoo y una UI de sugerencias.

Limitaciones conocidas:

- El auto-refresh usa el horario de NYSE para todo lo cargado. Para
  cripto (que opera 24/7) o mercados de otro huso, la app deja de
  actualizarse aunque su mercado siga abierto.
- El `points` de la matriz cuenta velas de la granularidad base, no del
  plazo activo: en semanal el tooltip informa más velas de las que
  realmente se usaron.
- Los indicadores sin rango fijo o categóricos todavía no tienen escala
  de color definida en `format.js`.

## Notas

Proyecto personal, uso doméstico. La instancia de SQL Server usada es
Developer Edition, que no está licenciada para producción; para cualquier
uso comercial habría que pasar a Express (gratis, límite de 10 GB por
base — de sobra para este volumen).