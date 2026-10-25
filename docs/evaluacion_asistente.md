# Evaluación del asistente

Generado con `npm run evaluar-asistente` el 2026-10-25.
Modelo de lenguaje: `qwen3.5`; embeddings: `embeddinggemma`; índice de
4120 fragmentos. 43 preguntas de referencia
(`app/tests/preguntas_asistente.json`). Las de **ajuste** se usaron para decidir cómo
busca el asistente; las de **reserva** se escribieron después y no intervinieron en esas
decisiones, así que miden si generalizan. Las **reformuladas** evitan las palabras de la
documentación. 3 preguntas son ajenas al proyecto.

La versión local usa la búsqueda híbrida; la publicada en Vercel no tiene embeddings
(Ollama Cloud no los ofrece) y busca solo por palabras.

Se probó también ampliar esa búsqueda con palabras clave que escribe el modelo de
lenguaje antes de buscar (fusionando la búsqueda de la pregunta y la de las claves).
No mejoró el resultado neto: ayudaba algo con las preguntas reformuladas y empeoraba
algo las directas, dentro de la variación entre ejecuciones. Se descartó porque añade
una llamada al modelo por pregunta sin una mejora medible.

## Recuperación: la fuente esperada está entre los 6 fragmentos

| Búsqueda                    | Ajuste · directas | Ajuste · reformuladas | Reserva · directas | Reserva · reformuladas |
| --------------------------- | ----------------- | --------------------- | ------------------ | ---------------------- |
| Palabras (BM25)             | 19/19             | 0/5                   | 9/10               | 4/6                    |
| Embeddings (embeddinggemma) | 18/19             | 3/5                   | 10/10              | 5/6                    |
| Híbrida (RRF)               | 19/19             | 3/5                   | 10/10              | 5/6                    |

## Respuestas con el dato esperado

| Grupo                           | Palabras (BM25) | Híbrida (RRF) |
| ------------------------------- | --------------- | ------------- |
| Ajuste · directas               | 18/19           | 19/19         |
| Ajuste · reformuladas           | 1/5             | 2/5           |
| Reserva · directas              | 8/10            | 10/10         |
| Reserva · reformuladas          | 1/6             | 3/6           |
| Ajenas al proyecto rechazadas   | 3/3             | 3/3           |
| Respuestas que citan una fuente | 40/40           | 40/40         |
| Tiempo medio de respuesta       | 2.3 s           | 2.5 s         |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas:

| Híbrida | Palabras | Pregunta                                                                                            | Respuesta (solo palabras, la de la versión publicada)                                                                                                                                |
| ------- | -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✓       | ✓        | ¿Qué parte de las reseñas del primer mes ha llegado el día 7?                                       | El día 7 ya se han recibido aproximadamente el 62 % de las reseñas que tendrá un juego al cumplir su primer mes [1][3]. Este dato indica que esperar hasta el día 30 para evaluar si |
| ✓       | ✓        | ¿Qué modelo usa el radar a día 7?                                                                   | A día 7, el Radar utiliza el "ratio típico" (la regla simple basada en las reseñas) como modelo elegido [4]. Este enfoque se seleccionó porque supera ligeramente al modelo Ridge y  |
| ✓       | ✓        | ¿Cuál es el factor de error típico del radar a día 14?                                              | El factor de error típico del radar a los 14 días es ×1,09 [2]. Esto significa que la estimación suele situarse entre un 9 % por debajo y un 13 % por encima del valor real final [2 |
| ✓       | ✓        | ¿Cuántos juegos son aptos para el modelo?                                                           | De las 4.069 muestras analizadas, quedan **3.019** juegos aptos para el modelo tras aplicar exclusiones como la falta de reseñas en inglés o precios no disponibles [2]. Ten en cuen |
| ✓       | ✓        | ¿Por qué todas las cifras son de reseñas en inglés?                                                 | Todas las cifras son de reseñas en inglés porque la API pública solo devuelve datos en ese idioma y, para los juegos grandes, Steam calcula el recuento basándose únicamente en él [ |
| ✓       | ✓        | ¿Cuántos juegos se excluyeron por haber salido de acceso anticipado?                                | Se excluyeron 357 juegos porque superaban el umbral del 5 % de sus reseñas anteriores a su fecha oficial, lo que indica que habían salido de acceso anticipado [2]. Esta cifra se su |
| ✓       | ✓        | ¿Cómo se calcula el intervalo del 90 %?                                                             | El intervalo del 90 % se calcula de forma explícita utilizando `np.quantile(method="higher")` para garantizar la cobertura con muestras finitas, en lugar de usar un método automáti |
| ✓       | ✓        | ¿Cómo se reparten los juegos entre entrenamiento, calibración y test?                               | Según las fuentes proporcionadas, la partición por fecha de lanzamiento incluye 1.811 juegos para entrenamiento [1], 604 para calibración y otros 604 para el conjunto de prueba (te |
| ✓       | ✓        | ¿Influye el porcentaje de reseñas positivas de la primera semana en cómo acaba el mes?              | Sí, influye significativamente; los juegos con más del 90% de reseñas positivas terminan cumpliendo lo previsto por su volumen inicial [5], mientras que aquellos con un 60% o menos |
| ✓       | ✓        | ¿Por qué la página Antes de lanzar no da una cifra concreta?                                        | La aplicación muestra un rango en lugar de una cifra antes del lanzamiento debido a que, según los análisis realizados, las variables como precio y género explican muy poco sobre e |
| ✓       | ✓        | ¿Cada cuánto se actualizan los datos de la aplicación?                                              | Los datos nuevos, como lanzamientos recientes o reentrenamiento de modelos, se descargan automáticamente el día 1 de cada mes mediante un flujo de GitHub Actions [1]. Además, para  |
| ✓       | ✓        | ¿Qué significa un factor de error típico de ×1,21?                                                  | Un factor de error típico de ×1,21 indica que la estimación del número total de reseñas a 30 días suele quedar entre un 17 % por debajo y un 21 % por encima del valor real [1]. Est |
| ✓       | ✓        | ¿Cuántas reseñas tuvo My Little Puppy a los 30 días?                                                | My Little Puppy acumuló 500 reseñas en inglés a los 30 días tras su lanzamiento [1]. Ten en cuenta que esta es una aproximación basada en la actividad de usuarios y no un indicador |
| ✓       | ✓        | ¿Quién desarrolló Super Woden: Rally Edge?                                                          | Super Woden: Rally Edge fue desarrollado por ViJuDa [1]. Ten en cuenta que esta cifra se basa únicamente en la actividad de reseñas y no representa directamente las ventas del jueg |
| ✓       | ✓        | ¿Cuánto cuesta 5omeday?                                                                             | El juego _5omeday_ tiene un precio de lanzamiento de **5,99 $** [1]. Ten en cuenta que esta cifra es el costo del producto y no una estimación basada en sus reseñas acumuladas.     |
| ✓       | ✓        | ¿Por qué Kebab Chefs! no se usó para entrenar el modelo?                                            | Kebab Chefs! fue excluido del entrenamiento porque más del 5 % de sus reseñas son anteriores a la fecha oficial, habiendo salido de acceso anticipado [1]. Por ello, las cifras y co |
| ✓       | ✓        | ¿Cuántas reseñas tenía Warhounds el día 7?                                                          | Warhounds tenía 297 reseñas en inglés acumuladas a los 7 días [2]. Este dato es una aproximación a su actividad temprana y no representa directamente sus ventas totales.            |
| ✓       | ✗        | ¿Cuándo salió DaemonBride:ADDITIONAL GAIN?                                                          | DaemonBride:ADDITIONAL GAIN se lanzó en Steam el 20 de diciembre de 2025 [1]. Ten en cuenta que esta fecha corresponde al lanzamiento oficial y no a una salida anticipada, ya que m |
| ✓       | ✓        | ¿Por qué Play Things quedó fuera de la muestra?                                                     | Play Things fue excluido de la muestra analizada porque no tuvo ninguna reseña en inglés durante su primer mes [1]. Esto significa que sus datos no se utilizaron para el entrenamie |
| ✗       | ✗        | ¿Cuánto se equivoca la herramienta una semana después del estreno?                                  | La herramienta sobreestima entre 10 y 200 reseñas al día 7, con un error mediano de −0,11 a −0,13 en logaritmo [2]. Esto significa que el número real suele quedar alrededor del 11  |
| ✓       | ✗        | ¿Qué pasa con un juego que recibe muchas críticas malas al principio?                               | Las fuentes proporcionadas no contienen información sobre cómo afectan las críticas negativas iniciales a la proyección del número total de reseñas. El asistente solo estima este v |
| ✗       | ✗        | ¿Se guarda lo que escriben los jugadores en sus opiniones?                                          | No se menciona el almacenamiento del texto completo de las opiniones, sino únicamente la recolección y análisis de cifras como reseñas positivas o negativas [3]. La aplicación util |
| ✗       | ✗        | ¿Por qué se dejan fuera los títulos que estuvieron en early access?                                 | Las fuentes proporcionadas no contienen información sobre por qué se excluyen específicamente a los juegos en _early access_. El documento menciona limitaciones como el idioma ingl |
| ✓       | ✓        | ¿De dónde salen los datos con los que trabaja la aplicación?                                        | La aplicación utiliza reseñas de Steam para estimar las cifras a 30 días y compara estos resultados con ventas anunciadas [2]. Los datos se obtienen mediante una ingesta automatiza |
| ✓       | ✓        | (reserva) ¿Cuántas reseñas tuvo REPLACED en su primer mes?                                          | REPLACED acumuló un total de 1867 reseñas en inglés durante los primeros 30 días tras su lanzamiento [1]. Ten en cuenta que esta cifra es una aproximación basada en la actividad y  |
| ✓       | ✓        | (reserva) ¿Quién desarrolló Exo Rally Championship?                                                 | Exo Rally Championship fue desarrollado por Exbleative [1]. Ten en cuenta que las cifras de reseñas reflejan la actividad del juego y no necesariamente sus ventas directas [1][2].  |
| ✓       | ✓        | (reserva) ¿Cuánto cuesta Orbitmine?                                                                 | Orbitmine cuesta 2,99 $ [1]. Ten en cuenta que las cifras de reseñas son aproximaciones a la actividad y no reflejan directamente el volumen de ventas del juego [4].                |
| ✓       | ✓        | (reserva) ¿Cuántas reseñas tenía Military Incremental Complex a los 7 días?                         | Military Incremental Complex tuvo 282 reseñas en inglés acumuladas a los 7 días [1]. Ten en cuenta que esta cifra es una aproximación de la actividad del juego y no refleja directa |
| ✓       | ✗        | (reserva) ¿Cuántas reseñas tiene el juego mediano al cumplir su primer mes?                         | No es posible determinar una cifra exacta de reseñas para el "juego mediano" basándose únicamente en las fuentes proporcionadas, ya que estos documentos analizan la proporción y ca |
| ✓       | ✓        | (reserva) ¿Qué día de la semana se lanzan más juegos?                                               | Los jueves concentran unos 800 lanzamientos, frente a los 500 del resto de días laborables y menos de 100 en fin de semana [3]. Ten en cuenta que estas cifras reflejan el calendari |
| ✓       | ✗        | (reserva) ¿Cuál es el multiplicador típico entre el día 7 y el día 30?                              | El multiplicador típico estimado para pasar del día 7 al día 30 es ×1,21 [3]. Este valor se basa en la relación casi lineal observada en escala logarítmica entre las reseñas de eso |
| ✓       | ✓        | (reserva) ¿Qué modelo usa el radar a día 3?                                                         | A día 3, el radar utiliza un modelo tipo Ridge para realizar las estimaciones [4]. Este enfoque es elegido porque ofrece una precisión ligeramente superior en comparación con otras |
| ✓       | ✓        | (reserva) ¿Cuántos juegos se excluyeron por no tener reseñas en inglés en su primer mes?            | Se excluyeron 689 juegos porque no recibieron ninguna reseña en inglés durante sus primeros días [1][3]. Esta exclusión es necesaria ya que el radar solo puede estimar las reseñas  |
| ✓       | ✓        | (reserva) ¿Con qué frecuencia acierta el veredicto «por debajo» a día 7?                            | El veredicto "Por debajo" al día 7 tiene una precisión del **95 %** para predecir que un juego acabará por debajo de lo esperado [1][2]. Este dato se basa en el análisis de reseñas |
| ✗       | ✗        | (reserva) ¿Gano algo esperando a la segunda semana para mirar los números?                          | No es recomendable esperar a la segunda semana porque el día 7 ya refleja aproximadamente el 62% de las reseñas finales del mes [5]. El modelo utiliza un multiplicador estable desd |
| ✓       | ✓        | (reserva) ¿Los juegos gratis se comportan distinto en su primer mes?                                | Las fuentes proporcionadas explican las exclusiones por falta de reseñas, acceso anticipado o precio [1][3], la distribución asimétrica del volumen total y el uso de transformacion |
| ✗       | ✗        | (reserva) ¿Es verdad que los juegos que salen ahora consiguen más opiniones que los de hace un año? | No es cierto; la muestra incluye solo lanzamientos entre octubre de 2025 y septiembre de 2026, por lo que no se puede comparar con datos de hace un año [3]. Además, el radar trabaj |
| ✓       | ✗        | (reserva) ¿En qué casos se equivoca más la herramienta?                                             | La herramienta sobreestima con mayor frecuencia cuando un juego tiene entre 10 y 200 reseñas a los siete días de lanzamiento [2]. Además, el error es notablemente mayor si las prim |
| ✗       | ✗        | (reserva) ¿Hasta qué punto me puedo fiar del margen que da la herramienta?                          | La aplicación estima las reseñas totales al mes basándose en multiplicadores aplicados a los datos iniciales, pero no ofrece una cifra exacta antes de lanzarse debido a un sesgo de |
| ✓       | ✗        | (reserva) ¿Puedo saber cuántas copias he vendido con esta herramienta?                              | No puedes obtener el número exacto de ventas directamente; la herramienta predice las reseñas basándose en datos iniciales, no convierte esas cifras a unidades vendidas [4]. Las re |
| ✓       | ✓        | ¿Cuál es la capital de Australia?                                                                   | No puedo responder a tu pregunta sobre la capital de Australia, ya que las fuentes proporcionadas solo contienen datos técnicos y estadísticas de reseñas para juegos específicos co |
| ✓       | ✓        | ¿Cuántas copias ha vendido My Little Puppy?                                                         | No se puede determinar el número exacto de ventas de _My Little Puppy_ con la información proporcionada, ya que las fuentes solo ofrecen datos sobre reseñas en inglés y no especifi |
| ✓       | ✓        | ¿Qué nota tiene Elden Ring en Metacritic?                                                           | No se puede responder con la información proporcionada, ya que las fuentes solo contienen datos sobre "Tale of Immortal Ring" y "The Prisoning: Fletcher's Quest", pero no mencionan |
