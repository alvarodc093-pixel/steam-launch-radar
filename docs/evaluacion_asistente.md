# Evaluación del asistente

Generado con `npm run evaluar-asistente` el 2026-10-24.
Modelo de lenguaje: `qwen3.5`; embeddings: `embeddinggemma`; índice de
4114 fragmentos; 22 preguntas de referencia
(`app/tests/preguntas_asistente.json`), 3 de ellas fuera del alcance del proyecto.

## Recuperación

18 preguntas con un fragmento esperado. Acierto@1: el fragmento sale
el primero; acierto@6: está entre los 6 que recibe el modelo; MRR: media de
1 / posición (0 si no aparece).

| Búsqueda                    | Acierto@1 | Acierto@6 | MRR  |
| --------------------------- | --------- | --------- | ---- |
| Palabras (BM25)             | 78 %      | 100 %     | 0.89 |
| Embeddings (embeddinggemma) | 61 %      | 94 %      | 0.73 |
| Híbrida (RRF)               | 83 %      | 100 %     | 0.89 |

## Respuestas (búsqueda híbrida)

| Métrica                                      | Resultado       |
| -------------------------------------------- | --------------- |
| Contienen el dato esperado                   | 19 / 19 (100 %) |
| Citan al menos una fuente                    | 19 / 19 (100 %) |
| Reconocen que no lo saben (fuera de alcance) | 3 / 3           |
| Tiempo medio de respuesta                    | 1.7 s           |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guarda cada respuesta:

|     | Pregunta                                                                               | Respuesta                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✓   | ¿Qué parte de las reseñas del primer mes ha llegado el día 7?                          | El día 7 ya se han recibido aproximadamente el 62 % de las reseñas que tendrá el juego al cumplir su primer mes [1][2]. Esta cifra representa más de la mitad del total mensual, lo que permite estimar el rendimiento final |
| ✓   | ¿Qué modelo usa el radar a día 7?                                                      | El Radar utiliza el **ratio típico** (una regla simple basada en las reseñas) para estimar al séptimo día [2][4]. Este enfoque es elegido porque, tras la validación cruzada temporal dentro del entrenamiento de 1.811 jueg |
| ✓   | ¿Cuál es el factor de error típico del radar a día 14?                                 | A día 14, el factor de error típico del radar es ×1,09 [2]. Este valor indica que las estimaciones suelen situarse entre un 9 % por debajo y un 11 % por encima del número real de reseñas a los 30 días.                    |
| ✓   | ¿Cuántos juegos son aptos para el modelo?                                              | Según los datos, quedan **3.019** juegos aptos del total de la muestra inicial [2]. De estos, se excluyeron específicamente 689 títulos que no recibieron ninguna reseña en inglés durante su primer mes y otros con problem |
| ✓   | ¿Por qué todas las cifras son de reseñas en inglés?                                    | Todas las cifras corresponden a reseñas en inglés porque la API pública utilizada para obtener los datos solo devuelve este idioma [1][2]. Por ello, el proyecto y la aplicación se limitan exclusivamente a medir esta métr |
| ✓   | ¿Cuántos juegos se excluyeron por haber salido de acceso anticipado?                   | Se excluyeron 357 juegos porque más del 5 % de sus reseñas aparecieron antes de su fecha oficial, indicando que habían salido de acceso anticipado [2]. Esta exclusión es necesaria para evitar distorsionar la curva típica |
| ✓   | ¿Cómo se calcula el intervalo del 90 %?                                                | El intervalo del 90 % se calcula utilizando métodos conformes basados en el cuantil de los errores obtenidos durante el bloque de calibración [1]. Este enfoque permite cubrir aproximadamente el 92-93 % de los casos reale |
| ✓   | ¿Cómo se reparten los juegos entre entrenamiento, calibración y test?                  | La muestra está dividida en 1.811 juegos para entrenamiento, 604 para calibración y otros 604 (los más recientes) para el conjunto de prueba [1]. No se inventan cifras ni juegos; todas las reseñas son aproximaciones a la |
| ✓   | ¿Influye el porcentaje de reseñas positivas de la primera semana en cómo acaba el mes? | Sí, influye significativamente; según los datos, si al día 7 tienes el 60 % o menos de reseñas positivas, terminarás el mes un 21 % por debajo del volumen predicho solo por tu número inicial [2]. Por el contrario, con má |
| ✓   | ¿Por qué la página Antes de lanzar no da una cifra concreta?                           | La aplicación no ofrece una cifra exacta antes del lanzamiento porque los datos previos son insuficientes para predecir el juego concreto, ya que tanto el precio como el género explican muy poco sobre el volumen final [2 |
| ✓   | ¿Cada cuánto se actualizan los datos de la aplicación?                                 | Los datos se reentrenan cada mes cuando cierran su primer mes nuevos lanzamientos [3]. El proceso automático incluye abrir un Pull Request con las métricas para revisar el sesgo antes de publicar cambios [3].             |
| ✓   | ¿Qué significa un factor de error típico de ×1,21?                                     | Un factor de error típico de ×1,21 indica que la estimación del número total de reseñas a los 30 días se desvía en el juego mediano entre un 17 % por debajo y un 21 % por encima del valor real [1]. Este nivel de precisió |
| ✓   | ¿Cuántas reseñas tuvo My Little Puppy a los 30 días?                                   | My Little Puppy acumuló un total de 500 reseñas en inglés al cumplir su primer mes [1]. Ten en cuenta que esta cifra es una aproximación basada en la actividad y no representa directamente las ventas del juego.           |
| ✓   | ¿Quién desarrolló Super Woden: Rally Edge?                                             | Super Woden: Rally Edge fue desarrollado por ViJuDa [1]. Ten en cuenta que esta cifra se basa únicamente en la información proporcionada y no representa necesariamente las ventas del juego, sino una aproximación a su act |
| ✓   | ¿Cuánto cuesta 5omeday?                                                                | El juego _5omeday_ cuesta 5,99 $ [1]. Ten en cuenta que esta cifra es el precio de venta y no una estimación basada en las reseñas acumuladas hasta los primeros días.                                                       |
| ✓   | ¿Por qué Kebab Chefs! no se usó para entrenar el modelo?                               | Kebab Chefs! fue excluido del entrenamiento porque más del 5 % de sus reseñas son anteriores a la fecha oficial, habiendo salido de acceso anticipado [1]. Por esta razón, no forma parte de la muestra analizada ni se util |
| ✓   | ¿Cuántas reseñas tenía Warhounds el día 7?                                             | Warhounds tenía 297 reseñas en inglés acumuladas al séptimo día [1]. Ten en cuenta que esta cifra es una aproximación a la actividad del juego y no refleja sus ventas directas, además de estar expresada solo para reseñas |
| ✓   | ¿Cuándo salió DaemonBride:ADDITIONAL GAIN?                                             | DaemonBride:ADDITIONAL GAIN se lanzó en Steam el 30 de diciembre de 2025 [1]. Ten en cuenta que esta cifra es una aproximación basada en la actividad (reseñas) y no refleja directamente las ventas del juego.              |
| ✓   | ¿Por qué Play Things quedó fuera de la muestra?                                        | Play Things [1] se excluyó de la muestra analizada porque no obtuvo ninguna reseña en inglés durante su primer mes, lo que impide utilizar sus datos para el entrenamiento del modelo. Esto es consistente con las limitacio |
| ✓   | ¿Cuál es la capital de Australia?                                                      | No puedo responder a tu pregunta sobre la capital de Australia utilizando las fuentes proporcionadas [1]-[6], ya que contienen únicamente datos técnicos y estadísticas de reseñas de juegos en Steam, sin información geogr |
| ✓   | ¿Cuántas copias ha vendido My Little Puppy?                                            | No es posible determinar cuántas copias de _My Little Puppy_ se han vendido con la información proporcionada [1]. Los datos disponibles solo indican el número acumulado de reseñas en inglés (500 a los 30 días) y su porce |
| ✓   | ¿Qué nota tiene Elden Ring en Metacritic?                                              | No se puede determinar la puntuación de _Elden Ring_ en Metacritic con las fuentes proporcionadas [1][2][3][5][6], ya que ninguna contiene información sobre este título ni sus reseñas. Para obtener esa cifra, deberías co |
