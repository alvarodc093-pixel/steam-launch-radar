# Steam Launch Radar

Estima con las reseñas de los primeros días cuántas tendrá un juego de Steam al cumplir
su primer mes y si eso es mucho o poco para su género.

**Aplicación:** <https://steam-launch-radar.vercel.app>

![Radar con un lanzamiento real del conjunto de test](docs/capturas/radar.png)

Un estudio pequeño que publica un juego en Steam pasa el primer mes a ciegas: ve
entrar reseñas, pero no sabe si son muchas o pocas para un juego como el suyo hasta
que ya es tarde para reaccionar. **Steam Launch Radar** toma las reseñas de los
primeros 3, 7 o 14 días, estima cuántas tendrá el juego al cumplir 30 y dice si eso
está por encima, en línea o por debajo de lo habitual en su género. Antes del
lanzamiento, en lugar de inventar una cifra, enseña el rango de juegos parecidos.

Lo completan un **asistente con RAG** que responde preguntas sobre los datos y el
modelo citando sus fuentes, y un **panel de Power BI** con los indicadores de la
muestra y la calidad del modelo.

---

## 1. Problema y usuario

El usuario es quien lleva el lanzamiento en un estudio indie o en un editor pequeño.
En la primera semana tiene que decidir si refuerza el marketing, adelanta una oferta o
prioriza un parche, y solo cuenta con un número suelto: las reseñas que lleva. Con el
radar introduce ese número (más el precio, el género y el porcentaje de positivas) y
obtiene:

- una estimación de las reseñas a 30 días con un rango del 90 %,
- dónde queda frente a los lanzamientos de su género,
- un veredicto que solo se pronuncia cuando todo el rango queda por encima o por
  debajo de lo normal.

Antes no tenía con qué compararse: SteamDB o la propia tienda muestran juegos uno a
uno, no cómo suele evolucionar un lanzamiento parecido en su primer mes.

## 2. Datos

| Fuente                                                                   | Qué aporta                                                                          | Acceso                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Buscador de la tienda de Steam (`store.steampowered.com/search/results`) | Todos los lanzamientos de un periodo, ordenados por fecha, con su número de reseñas | Sin clave; la ruta `/search/` no está excluida en el `robots.txt`                     |
| Ficha de la tienda (`store.steampowered.com/api/appdetails`)             | Fecha de lanzamiento, precio de lista en dólares y géneros                          | Sin clave, unas 200 peticiones cada 5 minutos                                         |
| Steam Web API (`IUserReviewsService/GetAppReviews`)                      | Fecha y voto de cada reseña pública                                                 | Sin clave; [condiciones de la Steam Web API](https://steamcommunity.com/dev/apiterms) |

- **Muestra:** todos los juegos del buscador lanzados entre el 29-10-2025 y el
  09-09-2026 con entre 50 y 10.000 reseñas: 4.069 juegos, de los que 3.019 son aptos
  para el modelo. Descarga del 24-10-2026.
- **Dos límites de la API sin clave**, comprobados al construir la ingesta: solo
  devuelve reseñas en inglés (en el juego mediano, el 40 % del total) y solo las del
  último año. Por eso todas las cifras son reseñas en inglés y la muestra se limita a
  los lanzamientos de los últimos doce meses.
- **Privacidad:** de cada reseña solo se guardan la fecha y el voto, agregados por día.
  El texto y el identificador del autor se descartan al leer la página.
- **Obtención:** `python -m radar.ingesta` descarga todo (1-2 horas por los límites de
  las APIs; se puede cortar y reanudar). Las tablas procesadas ya vienen en el
  repositorio, así que no hace falta para usar la app.

Diccionario de las tablas de `data/processed/`:

| Tabla                 | Filas                                              | Columnas principales                                                                                                                                          |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `juegos.csv`          | 4.069                                              | `appid`, `nombre`, `fecha_lanzamiento`, `precio_usd`, `genero_principal`, `banda_precio`, `resenas_30d`, `pct_previas`, `estado` (apto o motivo de exclusión) |
| `resenas_diarias.csv` | una por juego y día con reseñas, del día −30 al 89 | `appid`, `dia` (0 = lanzamiento), `positivas`, `negativas`, `resenas`                                                                                         |
| `dataset_radar.csv`   | 3.019                                              | variables previas al lanzamiento, `resenas_{3,7,14}d`, `pct_positivas_{3,7,14}d` y el objetivo `resenas_30d`                                                  |

## 3. Preprocesamiento y EDA

[`notebooks/01_preproceso.ipynb`](notebooks/01_preproceso.ipynb) recorre la limpieza
con los datos reales; la lógica vive en `src/radar/preparacion.py`.

- Cada reseña se sitúa en su día relativo a la fecha oficial de lanzamiento.
- Se excluyen 689 juegos sin ninguna reseña en inglés en su primer mes, 357 con más del
  5 % de sus reseñas antes de la fecha oficial (salieron de acceso anticipado, el
  _early access_ de Steam: su día 0 no es un estreno) y 4 sin precio en dólares.
- El volumen es muy asimétrico (mediana de 48 reseñas a 30 días, media de 220): se
  trabaja en log(1 + reseñas). Los juegos más grandes son lanzamientos reales y no se
  recortan.

[`notebooks/02_eda.ipynb`](notebooks/02_eda.ipynb) responde siete preguntas. Las que
deciden el producto:

- **Las reseñas llegan pronto:** el día 3 ya está el 36 % del mes, el día 7 el 62 % y
  el día 14 el 83 %. Esperar al día 30 es perder tiempo de reacción.
- **La relación es casi lineal en log** (ρ de Spearman de 0,98 entre el día 7 y el 30): la
  regla «reseñas de hoy × multiplicador típico» ya es un baseline exigente.
- **La opinión temprana cuenta:** con el mismo volumen a día 7, un juego con el 60 % o
  menos de positivas acaba un 21 % por debajo de lo esperado.
- **Antes de lanzar, el precio y el género explican poco** (ε² de 0,11 y 0,03): sirven
  para situar un rango, no para dar una cifra.
- **Sesgo de selección:** la mediana a 30 días sube trimestre a trimestre (36 → 60)
  porque los lanzamientos recientes necesitan ser más grandes para tener 50 reseñas el
  día de la descarga.

## 4. Ciencia de datos

[`notebooks/03_modelo.ipynb`](notebooks/03_modelo.ipynb) y `src/radar/modelo.py`.

- **Objetivo:** log(1 + reseñas en inglés a 30 días).
- **Partición por fecha de lanzamiento:** 1.811 juegos de entrenamiento, 604 de
  calibración y 604 de test (los más recientes, de julio a septiembre de 2026).
- **Candidatos:** la mediana, el ratio típico de la muestra (la regla de la hoja de
  cálculo), Ridge y gradient boosting. Se elige por validación cruzada temporal dentro
  del entrenamiento; el test se usa una sola vez.
- **Intervalo del 90 %:** conformal, con el cuantil de los errores en el bloque de
  calibración.

Resultado en test, sobre lanzamientos que el modelo no vio:

| Lectura         | Modelo elegido    | Factor de error típico    | Dentro de ×2 | Cobertura del rango del 90 % |
| --------------- | ----------------- | ------------------------- | ------------ | ---------------------------- |
| Día 3           | Ridge             | ×1,34                     | 92 %         | 93 %                         |
| Día 7           | Ratio típico      | ×1,21                     | 98 %         | 92 %                         |
| Día 14          | Ratio típico      | ×1,09                     | 99,5 %       | 93 %                         |
| Antes de lanzar | Gradient boosting | ×2,56 (la mediana: ×2,39) | 37 %         | 92 %                         |

«Factor de error típico» es la desviación en el juego mediano: ×1,21 significa que la
estimación queda entre un 17 % por debajo y un 21 % por encima del valor real.

- **A día 7 y 14 gana la regla simple.** Ridge y gradient boosting quedan dentro del
  ruido entre pliegues, y casi todo el peso está en las reseñas acumuladas. Se respeta
  lo que dice la validación: más complejidad sin mejora fuera de muestra solo añade
  riesgo.
- **Antes de lanzar no hay modelo útil.** El elegido baja el error medio pero empeora el
  del juego típico, también sin el mes de lanzamiento. Por eso la app no da una cifra
  previa y muestra el rango de juegos parecidos.
- **Limitaciones:** las reseñas en inglés son una aproximación a la actividad, no a las
  ventas; la muestra deja fuera los lanzamientos con menos de 50 reseñas y los éxitos
  con más de 10.000; en el periodo de test el modelo sobreestima en torno a un 11 % los
  juegos de 10 a 200 reseñas a día 7 (el rango lo absorbe, pero hay que vigilarlo al
  reentrenar).

### Asistente (RAG)

`src/radar/rag.py` construye el índice y `app/src/lib/rag.ts` hace la recuperación.

- **Corpus:** 4.114 fragmentos. 45 salen del README y de las celdas de texto de los
  notebooks, cortados por secciones, y el resto son una ficha por juego descargado con
  sus cifras (precio, géneros, estudio, reseñas los días 3, 7, 14 y 30, y por qué se
  excluyó si es el caso).
- **Recuperación:** BM25 sobre las palabras y similitud de coseno sobre embeddings
  de `embeddinggemma` (Ollama), combinados con Reciprocal Rank Fusion. Los vectores
  se guardan normalizados y cuantizados a int8, así que el índice entero pesa 6 MB y
  no hace falta una base de datos vectorial. En la búsqueda híbrida las palabras se
  reducen a una raíz de 6 letras («opiniones» y «opinión» cuentan igual). Entre los
  seis fragmentos que recibe el modelo entran como mucho dos fichas de juegos, para
  que no desplacen a la documentación.
- **Generación:** un modelo servido con Ollama (`qwen3.5` en local, `gpt-oss:120b`
  de Ollama Cloud en Vercel) recibe esos fragmentos con la instrucción de responder
  solo con ellos y citar cada dato con su número.
- **Evaluación** (`npm run evaluar-asistente`, detalle en
  [`docs/evaluacion_asistente.md`](docs/evaluacion_asistente.md)): 27 preguntas de
  referencia, cada una con las secciones que contienen la respuesta. 19 son
  directas, 5 están reformuladas sin las palabras de la documentación («¿cuánto se
  equivoca la herramienta una semana después del estreno?») y 3 son ajenas al
  proyecto.

| Búsqueda                  | Directas: fuente entre las 6 | Reformuladas: fuente entre las 6 | Respuestas correctas (directas · reformuladas) |
| ------------------------- | ---------------------------- | -------------------------------- | ---------------------------------------------- |
| Híbrida (local)           | 100 %                        | 80 %                             | 19/19 · 3/5                                    |
| Solo palabras (en Vercel) | 100 %                        | 20 %                             | 18/19 · 2/5                                    |

En los dos modos todas las respuestas citan su fuente y las 3 preguntas ajenas se
rechazan, con 1-2 segundos por respuesta.

- **Qué se aprendió midiendo:** reducir las palabras a su raíz mejora la búsqueda
  híbrida pero empeora la de solo palabras (crea coincidencias falsas que los
  embeddings ya no compensan), así que cada modo usa lo que le funciona. Sin el cupo
  de fichas, una pregunta sobre _early access_ se llenaba de juegos con ese género.
- **Limitaciones:** las preguntas reformuladas son las difíciles: sin embeddings la
  búsqueda solo encuentra la fuente en 1 de 5, y Ollama Cloud no ofrece embeddings,
  así que la versión publicada busca solo por palabras. Las decisiones de la
  búsqueda se tomaron con este mismo conjunto de 27 preguntas, que es pequeño. La
  comprobación de las respuestas busca la cifra o el término esperado, así que una
  respuesta correcta redactada de otra forma cuenta como fallo; por eso el informe
  guarda cada respuesta.

## 5. La aplicación

| Sección             | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Radar** (`/`)     | Estimación a 30 días, comparación con la cohorte, veredicto y trayectoria esperada. Se puede probar con 604 lanzamientos reales del test y ver lo que pasó después. Admite enlaces directos del tipo `/?juego=4113940&dia=7`. Antes de la primera lectura enseña tres casos reales (uno por veredicto) que se leen con un clic, la precisión del modelo según el día y cuándo llegan las reseñas; debajo, los hallazgos del EDA que explican el diseño del radar. |
| **Antes de lanzar** | Reseñas a 30 días de juegos del mismo género y precio (mediana y mitad central).                                                                                                                                                                                                                                                                                                                                                                                  |
| **Mercado**         | Indicadores de la muestra: ritmo del primer mes, géneros, precio, lanzamientos por mes y exclusiones.                                                                                                                                                                                                                                                                                                                                                             |
| **Asistente**       | Chat con RAG: responde con la documentación y las fichas de los juegos, cita cada dato y enseña las fuentes recuperadas aunque el modelo de lenguaje no responda.                                                                                                                                                                                                                                                                                                 |
| **Metodología**     | Datos, comparación de candidatos, métricas de test y limitaciones, leídas de los mismos JSON que usa el modelo, y un resumen del asistente y del panel.                                                                                                                                                                                                                                                                                                           |

API del servidor:

| Ruta                        | Respuesta                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/radar`           | Lectura del radar. Cuerpo: `dia` (3, 7 o 14), `resenas` (entero), `pct_positivas` (fracción de 0 a 1, opcional), `precio_usd` y `genero`.                                                                                                              |
| `POST /api/previo`          | Referencia antes de lanzar. Cuerpo: `precio_usd`, `mes_lanzamiento` (1-12) y `genero`.                                                                                                                                                                 |
| `GET /api/ejemplos/{appid}` | Ficha y reseñas diarias reales de un lanzamiento del test.                                                                                                                                                                                             |
| `POST /api/asistente`       | Respuesta del asistente en NDJSON: una línea con las fuentes, los trozos de texto según se generan y una de cierre o error. Cuerpo: `mensajes` (lista de `{rol, texto}`, el último del usuario). Como mucho 20 preguntas por IP cada 10 minutos (429). |

Las entradas se validan en el formulario y otra vez en el servidor, con mensajes que
nombran el campo erróneo (400). Si faltan los datos exportados, las páginas y la API
lo dicen y explican cómo generarlos (503). Si Ollama no responde, el asistente lo
dice con un mensaje claro y deja a la vista los fragmentos que encontró.

### Panel de inteligencia (Power BI)

[`powerbi/SteamLaunchRadar.pbip`](powerbi/) es un proyecto de Power BI en formato de
texto (modelo semántico en TMDL e informe en PBIR) que `python -m radar.powerbi` genera
junto con sus datos. Cada página responde a una pregunta:

| Página                   | Pregunta                                       | Contenido                                                                      |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| **Mercado**              | ¿Cómo es un lanzamiento típico en Steam?       | Lanzamientos, mediana de reseñas y de positivas, por mes, género y precio      |
| **Ritmo del primer mes** | ¿Cuándo llegan las reseñas?                    | Parte del mes recibida día a día y en los días 3, 7 y 14                       |
| **Calidad del modelo**   | ¿Cuánto acierta el radar en juegos que no vio? | Factor de error, cobertura del rango, estimación frente a realidad, candidatos |
| **Detalle por juego**    | ¿Qué estimó para cada juego del test?          | Tabla con la lectura, el rango y el valor real                                 |

El modelo es una estrella: `juegos`, `calendario` y `lecturas` como dimensiones, y
`curva_diaria`, `predicciones` y `metricas` como hechos. Las consultas leen los CSV de
`powerbi/datos/` desde GitHub, así que el panel se actualiza con «Actualizar» cuando
llegan datos nuevos; el parámetro `OrigenDatos` admite también una carpeta local. Un
test comprueba que el factor de error y la cobertura del panel coinciden con los de la
app.

| Radar antes de la primera lectura                     | Asistente                                 | Móvil                                                                             |
| ----------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| ![Portada del radar](docs/capturas/portada.png)       | ![Asistente](docs/capturas/asistente.png) | <img src="docs/capturas/movil.png" alt="Radar en un móvil de 375 px" width="180"> |
| **Antes de lanzar**                                   | **Mercado**                               | **Metodología**                                                                   |
| ![Antes de lanzar](docs/capturas/antes-de-lanzar.png) | ![Mercado](docs/capturas/mercado.png)     | ![Metodología](docs/capturas/metodologia.png)                                     |

## 6. Arquitectura y stack

```mermaid
flowchart LR
    subgraph Steam
        B[Buscador de la tienda]
        F[Ficha appdetails]
        R[GetAppReviews]
    end
    subgraph Python["Python · src/radar"]
        I[ingesta] --> P[preparacion]
        P --> M[modelo]
        M --> E[exportar]
        E --> RG[rag]
        E --> PB[powerbi]
    end
    B & F & R --> I
    I -. caché .-> RAW[(data/raw)]
    P --> CSV[(data/processed)]
    E --> JSON[(app/data/*.json)]
    E --> CD[(casos dorados)]
    RG --> IDX[(app/data/rag.json)]
    PB --> BI[(powerbi/)]
    subgraph Next["Next.js en Vercel"]
        JSON --> INF[Inferencia en TypeScript]
        INF --> UI[Páginas y API]
        IDX --> BUS[BM25 + embeddings]
        BUS --> UI
    end
    OL[Ollama] <--> BUS
    CD -. npm test .-> INF
    BI --> PBI[Power BI Desktop]
```

- **Ingesta:** `requests` con reintentos, respeto de `Retry-After` y una pausa por
  fuente. Cada paso guarda en `data/raw/` de forma atómica, así que una descarga
  cortada se reanuda donde se quedó.
- **Datos y modelo:** pandas y scikit-learn (Ridge, gradient boosting,
  `TimeSeriesSplit`), con el intervalo conformal escrito a mano.
- **Aplicación:** Next.js 16 (App Router), React 19, TypeScript y Chart.js. No hay
  base de datos ni Python en producción: los modelos viajan como JSON y se evalúan en
  el servidor de Next.
- **Asistente:** Ollama para los embeddings (`embeddinggemma`) y la generación
  (`qwen3.5` en local, un modelo de Ollama Cloud en Vercel). BM25, el coseno y la
  fusión están escritos en TypeScript, sin dependencias.
- **Panel:** Power BI Desktop con un proyecto `.pbip` (TMDL y PBIR) generado desde
  Python; los JSON del informe validan contra los esquemas públicos de Microsoft.
- **Calidad:** ruff, pytest con cobertura mínima del 90 %, ESLint, Prettier,
  `tsc --noEmit`, tests de Node y una prueba de humo contra el build de producción.
  Gitleaks revisa todo el historial en busca de secretos.
- **Automatización:** dos workflows de GitHub Actions. `ci.yml` ejecuta todas las
  comprobaciones en cada push y Pull Request. `actualizar-datos.yml` se lanza el día 1
  de cada mes (o a mano): descarga los lanzamientos nuevos, reentrena, reejecuta los
  notebooks y los tests, y abre un Pull Request con los datos y un resumen de las
  métricas para revisarlo antes de publicar. Vercel despliega cada push a `main`.

## 7. Instalación y ejecución

Requisitos: Python 3.13 y Node.js 20 o superior.

```bash
git clone https://github.com/alvarodc093-pixel/steam-launch-radar.git
cd steam-launch-radar
```

**Solo la aplicación** (los datos y modelos ya vienen en el repositorio):

```bash
cd app
npm ci
npm run dev                       # http://localhost:3000
```

**Entorno de Python** (para regenerar datos, notebooks o modelos y pasar sus tests):

```bash
python -m venv .venv
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Rehacer todo desde cero:

```bash
python -m radar.ingesta           # descarga de Steam (1-2 h, reanudable)
python -m radar.preparacion       # data/processed/*.csv
python -m radar.exportar          # app/data/*.json y casos dorados de la app
python -m radar.rag               # app/data/rag.json (índice del asistente; necesita Ollama)
python -m radar.powerbi           # powerbi/datos/*.csv y el proyecto .pbip
python -m radar.informe           # resumen de métricas en Markdown
```

La ingesta no necesita clave. Opcionalmente, copiar `.env.example` a `.env` y poner un
correo de contacto, que se añade al User-Agent de las peticiones.

**Asistente en local.** Con [Ollama](https://ollama.com) instalado y abierto:

```bash
ollama pull embeddinggemma        # embeddings de las preguntas
ollama pull qwen3.5               # modelo que redacta las respuestas
cd app && npm run dev             # http://localhost:3000/asistente
npm run evaluar-asistente         # vuelve a medir la calidad (unos 2 minutos)
```

Sin Ollama la app funciona igual y el asistente explica que no puede responder,
enseñando las fuentes que encontró. Para cambiar de modelo, copiar `.env.example` a
`app/.env.local` y ajustar las variables `OLLAMA_*`.

**Panel de Power BI.** Instalar [Power BI Desktop](https://aka.ms/pbidesktopstore)
(gratuito, Windows), abrir `powerbi/SteamLaunchRadar.pbip` y pulsar **Inicio →
Actualizar** para cargar los datos. Para entregarlo como un único archivo: **Archivo →
Guardar como → .pbix**.

### Comprobaciones

| Dónde  | Comando                                                     | Qué cubre                                                                                                     |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Raíz   | `ruff check . && ruff format --check .`                     | Estilo y errores en `src/`, `tests/` y notebooks                                                              |
| Raíz   | `pytest --cov`                                              | 71 tests de ingesta, preparación, modelo, exportación, índice del asistente y panel (cobertura del 98 %)      |
| `app/` | `npm run lint && npm run format:check && npm run typecheck` | ESLint, Prettier y tipos                                                                                      |
| `app/` | `npm test`                                                  | Inferencia en TypeScript frente a 2.416 casos calculados en Python, y recuperación y validación del asistente |
| `app/` | `npm run evaluar-asistente`                                 | Calidad del asistente con Ollama (recuperación y respuestas)                                                  |
| `app/` | `npm run build && npm run humo`                             | Arranca el build de producción y prueba páginas y API                                                         |

### Despliegue en Vercel

En Vercel, «Add New Project», importar el repositorio y fijar **Root Directory =
`app`**. El radar no necesita variables de entorno. El asistente sí, porque Vercel no
llega al Ollama de un equipo local: `OLLAMA_HOST=https://ollama.com`, `OLLAMA_API_KEY`
con una clave de [ollama.com/settings/keys](https://ollama.com/settings/keys) y
`OLLAMA_MODELO` con un modelo de la nube (por ejemplo `gpt-oss:120b`). Sin ellas, el
asistente responde con el aviso y las fuentes encontradas.

### Actualización mensual de los datos

El workflow necesita permiso para abrir Pull Requests: en GitHub, _Settings → Actions →
General → Workflow permissions_, marcar «Read and write permissions» y «Allow GitHub
Actions to create and approve pull requests». Se puede lanzar a mano desde la pestaña
_Actions_ con «Run workflow».

## 8. Estructura del repositorio

```
steam-launch-radar/
├── .github/workflows/
│   ├── ci.yml                    lint, tests, build, humo y gitleaks
│   └── actualizar-datos.yml      reentrenamiento mensual con Pull Request
├── data/
│   ├── raw/                      caché de la ingesta (no se versiona)
│   └── processed/                juegos, reseñas diarias y dataset del modelo
├── notebooks/                    01_preproceso · 02_eda · 03_modelo
├── src/radar/
│   ├── config.py                 rutas, ventana de lanzamientos y umbrales
│   ├── ingesta/                  buscador, ficha y reseñas de Steam
│   ├── preparacion.py            limpieza, exclusiones y variables
│   ├── modelo.py                 partición temporal, candidatos e intervalo conformal
│   ├── exportar.py               modelos y tablas para la app
│   ├── rag.py                    índice del asistente (fragmentos y embeddings)
│   ├── powerbi.py                tablas en estrella y proyecto de Power BI
│   └── informe.py                resumen de métricas
├── tests/                        pytest
├── powerbi/
│   ├── datos/                    CSV del modelo en estrella
│   ├── SteamLaunchRadar.pbip     se abre con Power BI Desktop
│   ├── SteamLaunchRadar.SemanticModel/   tablas, relaciones y medidas DAX (TMDL)
│   └── SteamLaunchRadar.Report/  páginas y visuales (PBIR)
├── app/
│   ├── data/                     modelos, tablas e índice del asistente
│   ├── src/app/                  páginas y rutas de la API
│   ├── src/components/           formularios y gráficos
│   ├── src/lib/                  inferencia, validación y lectura de datos
│   ├── tests/                    casos dorados, preguntas de referencia y tests de Node
│   └── scripts/                  prueba de humo y evaluación del asistente
├── docs/
│   ├── capturas/
│   └── evaluacion_asistente.md   resultado de la última evaluación del asistente
├── requirements.txt              versiones exactas; instala también el paquete radar
├── pyproject.toml                ruff, pytest y cobertura
└── LICENSE
```

## 9. Decisiones técnicas y aprendizajes

- **Medir la API antes de diseñar la muestra.** La documentación no dice que, sin
  clave, `GetAppReviews` solo devuelve reseñas en inglés y del último año. Lo descubrí
  comparando sus recuentos con los de la tienda, y cambió el proyecto: el objetivo pasó
  a ser «reseñas en inglés» y la ventana, los últimos doce meses.
- **El baseline primero.** El ratio típico se implementó antes que cualquier modelo, y a
  días 7 y 14 nadie le gana fuera de muestra. Mantenerlo en producción es más honesto y
  más robusto que elegir el modelo que mejor queda en test.
- **No dar una cifra cuando el modelo no sirve.** Antes del lanzamiento ningún candidato
  mejora a la mediana en el juego típico, así que la app muestra un rango de juegos
  parecidos en lugar de una predicción.
- **Inferencia en TypeScript con casos dorados.** Exportar coeficientes y árboles a JSON
  evita un servicio de Python en producción. El riesgo es que las dos implementaciones
  diverjan, y lo cubren los 2.416 casos que Python calcula y la app tiene que reproducir
  con una diferencia menor de 0,0001 en log.
- **El intervalo conformal, escrito a mano.** `np.quantile(method="higher")` no da el
  estadístico de orden ⌈(n+1)·0,9⌉ que exige la garantía de cobertura con muestras
  finitas. Se calcula de forma explícita y un test lo fija con una muestra pequeña.
- **El sesgo de selección no se ve en las métricas.** Exigir 50 reseñas el día de la
  descarga favorece a los lanzamientos recientes más grandes. Afecta poco al radar, que
  trabaja con proporciones, pero descarta el mes de lanzamiento como variable previa.
- **Medir la recuperación antes de complicarla.** Con preguntas directas BM25 basta;
  con preguntas reformuladas los embeddings pasan de encontrar la fuente en 1 de 5 a
  4 de 5. Por eso el asistente combina las dos búsquedas cuando puede y, cuando no
  hay embeddings, baja a BM25 y lo dice en cada respuesta.
- **Fichas generadas, no texto libre.** Cada juego se describe con una plantilla a
  partir de las tablas procesadas, así que el asistente no puede citar una cifra que no
  esté en los datos del radar.
- **Power BI como código.** El panel se genera desde Python en formato de texto y lee
  los CSV desde GitHub: no hay rutas locales en el proyecto y la actualización mensual
  lo deja al día sin tocar Power BI.

## 10. Qué mejoraría con más tiempo

Lo que queda fuera no cabía en el plazo del proyecto o necesita datos que todavía no
existen:

- **Reseñas en todos los idiomas** con una clave de la Steam Web API, para incluir los
  juegos con público no anglófono que hoy se excluyen por no recibir reseñas en inglés.
- **Muestra sin sesgo de selección:** guardar el recuento del buscador cada mes y fijar
  la entrada por las reseñas del día 30, algo que la actualización mensual ya permite
  acumular.
- **Más señales tempranas,** como los jugadores simultáneos o los seguidores de la
  página de la tienda, para afinar la lectura del día 3, la más útil y la menos precisa.
- **Alertas:** seguir un juego por su `appid` y avisar al estudio cuando su lectura
  diaria cambie de veredicto.
- **Búsqueda híbrida también en la versión publicada,** con un servicio de embeddings
  en la nube, para que las preguntas reformuladas funcionen igual que en local.
- **Evaluar el asistente con preguntas reales** de quienes usen la app, en lugar de
  un conjunto escrito a mano, y medir también la calidad de la redacción.

## Convención de commits

Desde que el proyecto tiene CI y tests, los commits siguen
[Conventional Commits](https://www.conventionalcommits.org/es/) (los primeros, de la
construcción inicial, son frases descriptivas):
`tipo(ámbito): descripción` en imperativo o nominal, con los tipos `feat`, `fix`,
`refactor`, `test`, `docs`, `ci` y `chore`, y ámbitos como `ingesta`, `modelo`, `app`,
`datos` o `notebooks`. Ejemplo: `fix(modelo): estadístico de orden exacto en el
intervalo conformal`.

## Licencia

Código bajo licencia [MIT](LICENSE). Los datos proceden de Steam y están sujetos a sus
condiciones de uso.
