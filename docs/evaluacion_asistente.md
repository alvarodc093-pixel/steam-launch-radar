# Evaluación del asistente

Generado con `npm run evaluar-asistente` el 2026-10-24.
Modelo de lenguaje: `qwen3.5`; embeddings: `embeddinggemma`; índice de
4109 fragmentos; 22 preguntas de referencia
(`app/tests/preguntas_asistente.json`), 3 de ellas fuera del alcance del proyecto.

## Recuperación

18 preguntas con un fragmento esperado. Acierto@1: el fragmento sale
el primero; acierto@6: está entre los 6 que recibe el modelo; MRR: media de
1 / posición (0 si no aparece).

| Búsqueda                    | Acierto@1 | Acierto@6 | MRR  |
| --------------------------- | --------- | --------- | ---- |
| Palabras (BM25)             | 78 %      | 100 %     | 0.87 |
| Embeddings (embeddinggemma) | 67 %      | 100 %     | 0.77 |
| Híbrida (RRF)               | 78 %      | 100 %     | 0.88 |

## Respuestas (búsqueda híbrida)

| Métrica                                      | Resultado       |
| -------------------------------------------- | --------------- |
| Contienen el dato esperado                   | 19 / 19 (100 %) |
| Citan al menos una fuente                    | 19 / 19 (100 %) |
| Reconocen que no lo saben (fuera de alcance) | 3 / 3           |
| Tiempo medio de respuesta                    | 1.6 s           |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guarda cada respuesta:

|     | Pregunta                                                                               | Respuesta                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✓   | ¿Qué parte de las reseñas del primer mes ha llegado el día 7?                          | El día 7 ya se han recibido aproximadamente el 62 % de las reseñas que tendrá un juego al cumplir su primer mes [1][5]. Es importante recordar que estas cifras son una estimación basada en la actividad y no reflejan dire |
| ✓   | ¿Qué modelo usa el radar a día 7?                                                      | A día 7, la aplicación utiliza el "Ratio típico" (una regla simple basada en reseñas) como modelo elegido [4][5]. Este enfoque se seleccionó por validación cruzada temporal dentro del conjunto de entrenamiento y demostró |
| ✓   | ¿Cuál es el factor de error típico del radar a día 14?                                 | El factor de error típico del radar a día 14 es ×1,09 [2]. Este valor indica que la estimación se desvía en un juego mediano entre aproximadamente un 9 % por debajo y un 11 % por encima del valor real al cumplir el prime |
| ✓   | ¿Cuántos juegos son aptos para el modelo?                                              | De los 4.069 juegos analizados, quedan **3.019** aptos para el modelo tras excluir aquellos sin reseñas en inglés o con datos incompletos [2]. Esta cifra representa aproximadamente el 74 % de la muestra inicial disponibl |
| ✓   | ¿Por qué todas las cifras son de reseñas en inglés?                                    | Todas las cifras son de reseñas en inglés porque la API pública de Steam solo devuelve este tipo de datos [1][4]. Por ello, el proyecto se limita a medir y estimar únicamente sobre esa base disponible.                    |
| ✓   | ¿Cuántos juegos se excluyeron por haber salido de acceso anticipado?                   | Según las fuentes, se excluyeron un total de **357** juegos porque tuvieron una fase previa pública o salieron de acceso anticipado [2][4]. En el caso específico del juego _Speedball_, este fue uno de los 689 títulos eli |
| ✓   | ¿Cómo se calcula el intervalo del 90 %?                                                | El intervalo del 90 % se construye utilizando un enfoque conformal basado en el cuantil de los errores obtenidos durante el bloque de calibración [1]. Para garantizar la cobertura con muestras finitas, este estadístico s |
| ✓   | ¿Cómo se reparten los juegos entre entrenamiento, calibración y test?                  | Los datos están divididos en 1.811 juegos para el modelo de entrenamiento [1], 604 para la fase de calibración del intervalo de confianza [1] y otros 604 lanzamientos recientes (de julio a septiembre de 2026) que sirven  |
| ✓   | ¿Influye el porcentaje de reseñas positivas de la primera semana en cómo acaba el mes? | Sí, influye significativamente: si al día 7 tienes menos del 60 % de reseñas positivas, terminarás el mes un 21 % por debajo de lo que predice solo tu volumen [2]. Por el contrario, con más del 90 % de positivas, la esti |
| ✓   | ¿Por qué la página Antes de lanzar no da una cifra concreta?                           | La aplicación no proporciona una cifra exacta antes del lanzamiento porque el precio y el género explican muy poco sobre el volumen final de reseñas [2][3]. Además, los modelos predictivos disponibles empeoran las estima |
| ✓   | ¿Cada cuánto se actualizan los datos de la aplicación?                                 | Los datos del modelo se reentrenan cada mes cuando cierran su primer mes nuevos lanzamientos [4]. El proceso automático incluye abrir un Pull Request con las métricas para revisar el sesgo antes de publicar cualquier act |
| ✓   | ¿Qué significa un factor de error típico de ×1,21?                                     | Un factor de error típico de ×1,21 indica que la estimación del número total de reseñas a los 30 días suele situarse entre el 17 % por debajo y el 21 % por encima del valor real [1]. Este nivel de precisión se alcanza cu |
| ✓   | ¿Cuántas reseñas tuvo My Little Puppy a los 30 días?                                   | My Little Puppy acumuló un total de 500 reseñas en inglés al cumplir su primer mes [1]. Ten en cuenta que esta cifra es una aproximación basada únicamente en la actividad de las reseñas y no refleja el volumen exacto de  |
| ✓   | ¿Quién desarrolló Super Woden: Rally Edge?                                             | Super Woden: Rally Edge fue desarrollado por ViJuDa [1]. Ten en cuenta que esta cifra se basa únicamente en la información proporcionada y no representa necesariamente el volumen de ventas del juego.                      |
| ✓   | ¿Cuánto cuesta 5omeday?                                                                | 5omeday cuesta 5,99 $. [1] Ten en cuenta que esta cifra es el precio del juego y no una estimación de ventas basada en las reseñas acumuladas a día 30.                                                                      |
| ✓   | ¿Por qué Kebab Chefs! no se usó para entrenar el modelo?                               | Kebab Chefs! fue excluido del entrenamiento porque más del 5 % de sus reseñas son anteriores a la fecha oficial, lo que indica que salió en acceso anticipado [1]. Por esta razón, su estado en la muestra se marca como "ex |
| ✓   | ¿Cuántas reseñas tenía Warhounds el día 7?                                             | Warhounds tuvo 297 reseñas en inglés acumuladas al séptimo día [1]. Tenía un porcentaje de aprobación del 71% para ese momento.                                                                                              |
| ✓   | ¿Cuándo salió DaemonBride:ADDITIONAL GAIN?                                             | DaemonBride:ADDITIONAL GAIN se lanzó en Steam el 30 de diciembre de 2025 [1]. Ten en cuenta que esta cifra es una aproximación basada en la actividad y no refleja directamente las ventas del juego.                        |
| ✓   | ¿Por qué Play Things quedó fuera de la muestra?                                        | Play Things [1] y Hidden Things Beach Elves [3] fueron excluidos porque no tuvieron ninguna reseña en inglés durante sus primeros 30 días, lo que los hace inapropiados para el modelo. Según las limitaciones del sistema [ |
| ✓   | ¿Cuál es la capital de Australia?                                                      | Las fuentes proporcionadas no contienen información sobre la capital de Australia [1][2][3][4][5][6]. Para responder a esta pregunta, se debe consultar una fuente externa o el conocimiento general, ya que las aplicacione |
| ✓   | ¿Cuántas copias ha vendido My Little Puppy?                                            | No es posible determinar el número de ventas exactas de _My Little Puppy_ con la información proporcionada [1]. Las cifras disponibles son únicamente las reseñas acumuladas en inglés (500 al día 30), que sirven como apro |
| ✓   | ¿Qué nota tiene Elden Ring en Metacritic?                                              | No se puede responder a la pregunta sobre la puntuación de _Elden Ring_ en Metacritic utilizando las fuentes proporcionadas, ya que ninguna contiene información sobre este juego ni sus reseñas. Las fuentes disponibles so |
