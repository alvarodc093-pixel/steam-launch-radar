# Evaluación del asistente

Generado con `npm run evaluar-asistente` el 2026-10-25.
Modelo de lenguaje: `qwen3.5`; embeddings: `embeddinggemma`; índice de
4115 fragmentos. 27 preguntas de referencia
(`app/tests/preguntas_asistente.json`): 19 directas, 5
reformuladas sin las palabras de la documentación y 3 ajenas al proyecto.

## Recuperación

Cada pregunta tiene una o varias secciones que contienen la respuesta.
Acierto@1: una de ellas sale la primera; acierto@6: está entre los 6 fragmentos que
recibe el modelo; MRR: media de 1 / posición (0 si no aparece).

| Búsqueda                    | Directas: acierto@1 | acierto@6 | MRR  | Reformuladas: acierto@1 | acierto@6 | MRR  |
| --------------------------- | ------------------- | --------- | ---- | ----------------------- | --------- | ---- |
| Palabras (BM25)             | 89 %                | 100 %     | 0.93 | 0 %                     | 20 %      | 0.03 |
| Embeddings (embeddinggemma) | 63 %                | 95 %      | 0.76 | 60 %                    | 60 %      | 0.60 |
| Híbrida (RRF)               | 89 %                | 100 %     | 0.92 | 0 %                     | 80 %      | 0.23 |

## Respuestas

La búsqueda híbrida es la de la app en local; la de palabras, la de la versión
publicada en Vercel, donde Ollama Cloud no ofrece embeddings.

| Métrica                           | Híbrida         | Solo palabras  |
| --------------------------------- | --------------- | -------------- |
| Directas con el dato esperado     | 19 / 19 (100 %) | 18 / 19 (95 %) |
| Reformuladas con el dato esperado | 3 / 5 (60 %)    | 2 / 5 (40 %)   |
| Ajenas al proyecto rechazadas     | 3 / 3 (100 %)   | 3 / 3 (100 %)  |
| Respuestas que citan una fuente   | 24 / 24         | 24 / 24        |
| Tiempo medio de respuesta         | 1.6 s           | 1.3 s          |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas de la búsqueda híbrida:

| Híbrida | Palabras | Pregunta                                                                               | Respuesta (híbrida)                                                                                                                                                                                      |
| ------- | -------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✓       | ✓        | ¿Qué parte de las reseñas del primer mes ha llegado el día 7?                          | El día 7 ya han llegado aproximadamente el 62 % de las reseñas que tendrá un juego al cumplir su primer mes [1][2]. Esta cifra representa más de la mitad de la actividad total estimada para ese period |
| ✓       | ✓        | ¿Qué modelo usa el radar a día 7?                                                      | A día 7, la aplicación utiliza un "ratio típico" simple basado únicamente en las reseñas acumuladas para realizar su estimación [2][4]. Este enfoque se eligió porque añade complejidad sin mejorar sign |
| ✓       | ✓        | ¿Cuál es el factor de error típico del radar a día 14?                                 | El factor de error típico del radar al día 14 es ×1,09 [2]. Este valor indica que la estimación suele situarse entre un 9 % por debajo y un 11 % por encima del número real de reseñas a los 30 días.    |
| ✓       | ✓        | ¿Cuántos juegos son aptos para el modelo?                                              | De un total inicial de 4.069 juegos analizados, quedan **3.019** considerados aptos para el modelo [2]. Esta cifra se obtiene tras excluir principalmente a aquellos que no reciben reseñas en inglés o  |
| ✓       | ✓        | ¿Por qué todas las cifras son de reseñas en inglés?                                    | Todas las cifras provienen exclusivamente de reseñas en inglés porque la API pública utilizada para obtener los datos solo devuelve este tipo de contenido [1][2]. Por ello, el modelo y la aplicación s |
| ✓       | ✓        | ¿Cuántos juegos se excluyeron por haber salido de acceso anticipado?                   | Se excluyeron 357 juegos porque más del 5 % de sus reseñas fueron anteriores a su fecha oficial debido al lanzamiento desde acceso anticipado [4]. Esta cifra también aparece confirmada en la sección d |
| ✓       | ✓        | ¿Cómo se calcula el intervalo del 90 %?                                                | El intervalo del 90 % se calcula utilizando métodos conformes basados en el cuantil de los errores obtenidos durante el bloque de calibración [1]. Este enfoque permite cubrir aproximadamente el 92-93  |
| ✓       | ✓        | ¿Cómo se reparten los juegos entre entrenamiento, calibración y test?                  | La muestra está dividida en 1.811 juegos para el entrenamiento, 604 para la calibración y otros 604 (los más recientes) para el test [1]. Esta partición por fecha de lanzamiento permite evaluar al mod |
| ✓       | ✓        | ¿Influye el porcentaje de reseñas positivas de la primera semana en cómo acaba el mes? | Sí, influye significativamente: si a día 7 un juego tiene el 60 % o menos de reseñas positivas con el mismo volumen que otros, acabará su primer mes un 21 % por debajo de lo predicho solo por ese volu |
| ✓       | ✓        | ¿Por qué la página Antes de lanzar no da una cifra concreta?                           | La aplicación no proporciona una cifra concreta antes del lanzamiento porque el precio y el género explican muy poco sobre el volumen final de reseñas [2][4]. Además, los modelos predictivos complejos |
| ✓       | ✓        | ¿Cada cuánto se actualizan los datos de la aplicación?                                 | Los datos del modelo se reentrenan cada mes cuando cierran el primer mes nuevos juegos, proceso que genera un Pull Request para revisar y publicar las mejoras [3]. La ingesta completa de todos los lan |
| ✓       | ✓        | ¿Qué significa un factor de error típico de ×1,21?                                     | Un factor de error típico de ×1,21 indica que la estimación del modelo para las reseñas a 30 días se sitúa aproximadamente entre el 17 % por debajo y el 21 % por encima del valor real [2]. Este nivel  |
| ✓       | ✓        | ¿Cuántas reseñas tuvo My Little Puppy a los 30 días?                                   | My Little Puppy acumuló exactamente 500 reseñas en inglés al cumplir sus primeros 30 días [1]. Teniendo en cuenta que las cifras son aproximaciones de la actividad y no reflejan directamente el volume |
| ✓       | ✓        | ¿Quién desarrolló Super Woden: Rally Edge?                                             | Super Woden: Rally Edge fue desarrollado por ViJuDa [1]. Ten en cuenta que esta cifra se refiere al número de reseñas, no a las ventas del juego.                                                        |
| ✓       | ✓        | ¿Cuánto cuesta 5omeday?                                                                | El juego **5omeday** cuesta **5,99 $**. [1] Ten en cuenta que esta cifra es el precio del lanzamiento y no una estimación de ventas futuras basada en las reseñas.                                       |
| ✓       | ✓        | ¿Por qué Kebab Chefs! no se usó para entrenar el modelo?                               | Kebab Chefs! fue excluido del entrenamiento porque más del 5 % de sus reseñas son anteriores a la fecha oficial, habiendo salido de acceso anticipado [1]. Por esta razón, no forma parte de los datos u |
| ✓       | ✓        | ¿Cuántas reseñas tenía Warhounds el día 7?                                             | Warhounds tuvo 297 reseñas en inglés acumuladas al séptimo día [1]. Ten en cuenta que esta cifra es una aproximación a la actividad del juego y no representa sus ventas directas, además de estar expre |
| ✓       | ✗        | ¿Cuándo salió DaemonBride:ADDITIONAL GAIN?                                             | DaemonBride:ADDITIONAL GAIN se lanzó en Steam el 30 de diciembre de 2025 [1]. Ten en cuenta que todas las cifras de reseñas son aproximaciones a la actividad del juego y no reflejan directamente sus v |
| ✓       | ✓        | ¿Por qué Play Things quedó fuera de la muestra?                                        | Play Things se excluyó porque no recibió ninguna reseña en inglés durante su primer mes [1]. Esto impide que el radar genere una predicción útil, ya que las cifras estimadas basan sus cálculos exclusi |
| ✗       | ✗        | ¿Cuánto se equivoca la herramienta una semana después del estreno?                     | La herramienta sobreestima entre el 10 % y el 13 % cuando hay entre 10 y 200 reseñas a los siete días [1]. Si las reseñas son inferiores a 10 o superiores a 200, no existe un sesgo claro en la estimac |
| ✓       | ✓        | ¿Qué pasa con un juego que recibe muchas críticas malas al principio?                  | Un juego con el 60 % o menos de reseñas positivas a los primeros días acaba su mes significativamente por debajo del volumen predicho únicamente por sus primeras reseñas [2]. Esto indica que la opinió |
| ✓       | ✗        | ¿Se guarda lo que escriben los jugadores en sus opiniones?                             | No se guarda el texto escrito por los jugadores; solo se conservan la fecha y el voto (positivo o negativo) agregados por día [6]. Por ello, todas las cifras de reseñas son aproximaciones basadas únic |
| ✗       | ✗        | ¿Por qué se dejan fuera los títulos que estuvieron en early access?                    | No, las fuentes proporcionadas **no contienen** una explicación sobre por qué se excluyen específicamente a los juegos _Early Access_. Las únicas exclusiones detalladas son aquellos sin reseñas en ing |
| ✓       | ✓        | ¿De dónde salen los datos con los que trabaja la aplicación?                           | La aplicación utiliza una combinación de fuentes públicas como el buscador y las fichas de Steam para obtener lanzamientos, precios y géneros [5], así como la API pública de reseñas de Steam para reco |
| ✓       | ✓        | ¿Cuál es la capital de Australia?                                                      | No puedo responder a tu pregunta sobre la capital de Australia utilizando las fuentes proporcionadas [1][2], ya que estas solo contienen datos técnicos y estadísticas de reseñas para juegos específico |
| ✓       | ✓        | ¿Cuántas copias ha vendido My Little Puppy?                                            | No es posible determinar cuántas copias se han vendido basándose únicamente en las reseñas de los primeros días [1], ya que estas son solo una aproximación a la actividad del juego y no reflejan direc |
| ✓       | ✓        | ¿Qué nota tiene Elden Ring en Metacritic?                                              | No se puede responder a tu pregunta porque ninguna de las fuentes proporcionadas contiene información sobre _Elden Ring_ ni menciona su puntuación en Metacritic [1][2][3][4][5][6]. Para obtener esa ci |
