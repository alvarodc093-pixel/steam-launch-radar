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

| Búsqueda | Directas: acierto@1 | acierto@6 | MRR | Reformuladas: acierto@1 | acierto@6 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| Palabras (BM25) | 89 % | 100 % | 0.93 | 0 % | 0 % | 0.00 |
| Embeddings (embeddinggemma) | 63 % | 95 % | 0.77 | 60 % | 60 % | 0.60 |
| Híbrida (RRF) | 89 % | 100 % | 0.92 | 0 % | 60 % | 0.20 |

## Respuestas

La búsqueda híbrida es la de la app en local; la de palabras, la de la versión
publicada en Vercel, donde Ollama Cloud no ofrece embeddings.

| Métrica | Híbrida | Solo palabras |
| --- | --- | --- |
| Directas con el dato esperado | 19 / 19 (100 %) | 18 / 19 (95 %) |
| Reformuladas con el dato esperado | 3 / 5 (60 %) | 1 / 5 (20 %) |
| Ajenas al proyecto rechazadas | 3 / 3 (100 %) | 3 / 3 (100 %) |
| Respuestas que citan una fuente | 24 / 24 | 24 / 24 |
| Tiempo medio de respuesta | 1.4 s | 1.3 s |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas de la búsqueda híbrida:

| Híbrida | Palabras | Pregunta | Respuesta (híbrida) |
| --- | --- | --- | --- |
| ✓ | ✓ | ¿Qué parte de las reseñas del primer mes ha llegado el día 7? | El día 7 ya están disponibles aproximadamente el 62 % de las reseñas que tendrá un juego al cumplir su primer mes [1][2]. Esta cifra representa una estimación basada en la actividad y no directamente  |
| ✓ | ✓ | ¿Qué modelo usa el radar a día 7? | El Radar utiliza la regla del ratio típico (basada solo en las reseñas acumuladas) para estimaciones a día 7, ya que supera ligeramente al modelo Ridge en este punto [2][4]. Esta elección se mantiene  |
| ✓ | ✓ | ¿Cuál es el factor de error típico del radar a día 14? | El factor de error típico del radar al día 14 es ×1,09 [2]. Este valor indica que la estimación final se desvía en un juego mediano entre un 9 % por debajo y un 9 % por encima del valor real [2], basá |
| ✓ | ✓ | ¿Cuántos juegos son aptos para el modelo? | De un total inicial de 4.069 juegos analizados, quedan **3.019** considerados aptos para el modelo [2]. Esta cifra se obtiene tras excluir aquellos que no tienen reseñas en inglés o carecen de precio  |
| ✓ | ✓ | ¿Por qué todas las cifras son de reseñas en inglés? | Las cifras solo reflejan reseñas en inglés porque la API pública de Steam, que alimenta los datos del modelo, únicamente devuelve este idioma [1][5]. Por ello, el proyecto utiliza estas reseñas como i |
| ✓ | ✓ | ¿Cuántos juegos se excluyeron por haber salido de acceso anticipado? | Se excluyeron 357 juegos porque más del 5 % de sus reseñas aparecieron antes de su fecha oficial, indicando que habían salido de acceso anticipado [1]. Esta cifra también se confirma en el resumen de  |
| ✓ | ✓ | ¿Cómo se calcula el intervalo del 90 %? | El intervalo del 90 % se calcula utilizando métodos conformes basados en el cuantil de los errores obtenidos durante el bloque de calibración [1]. Este enfoque permite cubrir aproximadamente el 92-93  |
| ✓ | ✓ | ¿Cómo se reparten los juegos entre entrenamiento, calibración y test? | La muestra está dividida en 1.811 juegos para el entrenamiento, 604 para la calibración y otros 604 (los más recientes) para el test [1]. No se pueden inventar cifras ni juegos adicionales si las fuen |
| ✓ | ✓ | ¿Influye el porcentaje de reseñas positivas de la primera semana en cómo acaba el mes? | Sí, influye significativamente: con el mismo volumen a los siete días, un juego con el 60 % o menos de reseñas positivas termina el mes un 21 % por debajo del promedio [3], mientras que uno con más de |
| ✓ | ✓ | ¿Por qué la página Antes de lanzar no da una cifra concreta? | La aplicación no proporciona una cifra exacta antes del lanzamiento porque los datos previos (precio y género) explican muy poco sobre el volumen final, por lo que solo permiten situarse en un rango [ |
| ✓ | ✓ | ¿Cada cuánto se actualizan los datos de la aplicación? | Los datos se reentrenan cada mes cuando los juegos cierran su primer mes [2]. Este proceso incluye una comparación para revisar y corregir el sesgo antes de publicar las mejoras [2]. Para ejecutar est |
| ✓ | ✓ | ¿Qué significa un factor de error típico de ×1,21? | Un factor de error típico de ×1,21 indica que la estimación del modelo para las reseñas en inglés a 30 días se desvía en el juego mediano entre un 17 % por debajo y un 21 % por encima del valor real [ |
| ✓ | ✓ | ¿Cuántas reseñas tuvo My Little Puppy a los 30 días? | My Little Puppy acumuló exactamente 500 reseñas en inglés al cumplir sus primeros 30 días [1]. Teniendo en cuenta que la aplicación utiliza datos de reseñas para estimar el éxito y no ventas, este es  |
| ✓ | ✓ | ¿Quién desarrolló Super Woden: Rally Edge? | Super Woden: Rally Edge fue desarrollado por ViJuDa [1]. Ten en cuenta que esta cifra se basa únicamente en la información proporcionada y no refleja necesariamente el volumen de ventas del juego, sin |
| ✓ | ✓ | ¿Cuánto cuesta 5omeday? | El juego **5omeday** tiene un precio de lanzamiento de **5,99 $**. [1] Ten en cuenta que esta cifra corresponde al costo del producto y no a sus ventas estimadas. |
| ✓ | ✓ | ¿Por qué Kebab Chefs! no se usó para entrenar el modelo? | Kebab Chefs! fue excluido del entrenamiento porque más del 5 % de sus reseñas son anteriores a la fecha oficial, habiendo salido de acceso anticipado [1]. Por ello, su actividad no contribuye al conju |
| ✓ | ✓ | ¿Cuántas reseñas tenía Warhounds el día 7? | Warhounds tuvo 297 reseñas en inglés acumuladas al séptimo día [1]. Ten en cuenta que esta cifra es una aproximación a la actividad del juego y no representa sus ventas directas, además de estar expre |
| ✓ | ✗ | ¿Cuándo salió DaemonBride:ADDITIONAL GAIN? | DaemonBride:ADDITIONAL GAIN se lanzó en Steam el 30 de diciembre de 2025 [1]. Ten en cuenta que las cifras de reseñas son aproximaciones a la actividad del juego y no reflejan sus ventas directas. |
| ✓ | ✓ | ¿Por qué Play Things quedó fuera de la muestra? | Play Things fue excluido porque no recibió ninguna reseña en inglés durante su primer mes [1]. Esto impide que el radar genere una predicción útil, ya que las cifras basadas solo en inglés son aproxim |
| ✗ | ✗ | ¿Cuánto se equivoca la herramienta una semana después del estreno? | La herramienta sobreestima entre el 10 % y el 13 % cuando hay entre 10 y 200 reseñas a los siete días [1]. Este error disminuye si hay más volumen de datos, bajando a un 13 % con más de 200 reseñas o  |
| ✓ | ✗ | ¿Qué pasa con un juego que recibe muchas críticas malas al principio? | Un juego con una alta proporción de reseñas negativas iniciales (por ejemplo, 60 % o menos) terminará el mes significativamente por debajo del volumen predicho basándose únicamente en su número total  |
| ✓ | ✗ | ¿Se guarda lo que escriben los jugadores en sus opiniones? | No se guardan ni analizan los textos de las opiniones escritas por los jugadores; la aplicación utiliza únicamente el volumen total y el porcentaje de reseñas positivas (en inglés) para realizar estim |
| ✗ | ✗ | ¿Por qué se dejan fuera los títulos que estuvieron en early access? | No, las fuentes proporcionadas no explican por qué se excluyen específicamente a los juegos *Early Access*, aunque sí mencionan la exclusión de lanzamientos con menos de 50 reseñas [4] y el uso de dat |
| ✓ | ✓ | ¿De dónde salen los datos con los que trabaja la aplicación? | La aplicación obtiene sus datos de dos fuentes principales consultando directamente a Steam: primero usa su buscador para obtener todos los lanzamientos y luego consulta las fichas individuales del ju |
| ✓ | ✓ | ¿Cuál es la capital de Australia? | Las fuentes proporcionadas no contienen información sobre la capital de Australia [1][2]. Para responder a esta pregunta necesitarías consultar una fuente externa o el conocimiento general, ya que Ste |
| ✓ | ✓ | ¿Cuántas copias ha vendido My Little Puppy? | No es posible determinar cuántas copias ha vendido *My Little Puppy* con la información actual [1][3], ya que las cifras de reseñas son solo aproximaciones a la actividad del juego y no reflejan direc |
| ✓ | ✓ | ¿Qué nota tiene Elden Ring en Metacritic? | No se puede responder a tu pregunta porque ninguna de las fuentes proporcionadas contiene información sobre el juego *Elden Ring* ni menciona sus puntuaciones en Metacritic [1][2][3][4][5][6]. Para ob |
