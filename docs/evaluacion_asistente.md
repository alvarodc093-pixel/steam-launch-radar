# Evaluación del asistente

Generado con `npm run evaluar-asistente` el 2026-10-26.
Embeddings: `embeddinggemma`; índice de 4122 fragmentos.
43 preguntas de referencia (`app/tests/preguntas_asistente.json`). Las de
**ajuste** se usaron para decidir cómo busca el asistente; las de **reserva** se
escribieron después y no intervinieron en esas decisiones, así que miden si
generalizan. Las **reformuladas** evitan las palabras de la documentación.
3 preguntas son ajenas al proyecto.

La versión local y la publicada usan la misma búsqueda híbrida: la consulta se
convierte en vector dentro de la propia app (`app/src/lib/embeddings.ts`). Solo
cambia el modelo que redacta.

Se probó también ampliar la búsqueda por palabras con palabras clave que escribe el
modelo de lenguaje antes de buscar. No mejoró el resultado neto y se descartó.

## Recuperación: la fuente esperada está entre los 6 fragmentos

| Búsqueda | Ajuste · directas | Ajuste · reformuladas | Reserva · directas | Reserva · reformuladas |
| --- | --- | --- | --- | --- |
| Palabras (BM25) | 19/19 | 0/5 | 9/10 | 4/6 |
| Embeddings (embeddinggemma) | 18/19 | 3/5 | 10/10 | 5/6 |
| Híbrida (RRF) | 19/19 | 3/5 | 10/10 | 5/6 |

## Respuestas con el dato esperado

| Grupo | Local (qwen3.5) | Publicada (gpt-oss:120b) |
| --- | --- | --- |
| Ajuste · directas | 19/19 | 16/19 |
| Ajuste · reformuladas | 2/5 | 3/5 |
| Reserva · directas | 10/10 | 9/10 |
| Reserva · reformuladas | 2/6 | 1/6 |
| Ajenas al proyecto rechazadas | 2/3 | 1/3 |
| Respuestas que citan una fuente | 40/40 | 39/40 |
| Tiempo medio de respuesta | 1.5 s | 1.2 s |

## Calidad de la redacción (juez automático)

Cada respuesta la puntúa de 1 a 5 `deepseek-v4.1-flash`, un modelo de otra familia que los
que responden, con las mismas fuentes que recibió el asistente.

| Criterio | Local (qwen3.5) | Publicada (gpt-oss:120b) |
| --- | --- | --- |
| Fidelidad (media) | NaN | NaN |
| Pertinencia (media) | NaN | NaN |
| Claridad (media) | NaN | NaN |
| Fidelidad 4 o 5 | 0/0 | 0/0 |

Un juez automático también se equivoca: sirve para comparar configuraciones y
encontrar respuestas flojas, no como nota absoluta.

La comprobación del dato es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas (de Publicada (gpt-oss:120b)):

| Local | Publicada | Pregunta | Respuesta |
| --- | --- | --- | --- |
| ✓ | ✓ | ¿Qué parte de las reseñas del primer mes ha llegado el día 7? | Al día 7 ya se ha acumulado aproximadamente el **62 %** de las reseñas que tendrá el juego al cumplir el mes 30 [1][3]. |
| ✓ | ✓ | ¿Qué modelo usa el radar a día 7? | El radar utiliza el **ratio típico** (la regla simple basada solo en el número de reseñas) para la estimación a los 7 días [4]. |
| ✓ | ✓ | ¿Cuál es el factor de error típico del radar a día 14? | El factor de error típico del radar a los 14 días es aproximadamente × 1,09 [1]. |
| ✓ | ✗ | ¿Cuántos juegos son aptos para el modelo? | Hay 3 019 juegos que resultan aptos para el modelo (de un total de 4 069 juegos analizados)【1†L1-L4】【2†L1-L3】 |
| ✓ | ✓ | ¿Por qué todas las cifras son de reseñas en inglés? | Todas las cifras provienen exclusivamente de reseñas en inglés porque la API pública de Steam solo devuelve reseñas en ese idioma y, en los juegos con gran número de reseñas, el bu |
| ✓ | ✓ | ¿Cuántos juegos se excluyeron por haber salido de acceso anticipado? | Se excluyeron **357 juegos** porque tenían más del 5 % de sus reseñas antes de la fecha oficial, lo que indica que salieron de acceso anticipado【5】. |
| ✓ | ✓ | ¿Cómo se calcula el intervalo del 90 %? | El intervalo del 90 % se construye mediante un método conformal: se calcula el cuantil correspondiente de los errores cometidos en el bloque de calibración (las 604 partidas usadas |
| ✓ | ✗ | ¿Cómo se reparten los juegos entre entrenamiento, calibración y test? | Los juegos se dividieron por fecha de lanzamiento en tres bloques: - **Entrenamiento:** 1 811 juegos. - **Calibración:** 604 juegos. - **Test:** 604 juegos (los más recientes, de j |
| ✓ | ✓ | ¿Influye el porcentaje de reseñas positivas de la primera semana en cómo acaba el mes? | Sí. Con el mismo número de reseñas a los 7 días, un juego que tenga ≤ 60 % de reseñas positivas termina el mes aproximadamente un 21 % por debajo de lo que su volumen predeciría (r |
| ✓ | ✓ | ¿Por qué la página Antes de lanzar no da una cifra concreta? | Porque antes del lanzamiento los datos disponibles (precio, género y mes) no permiten estimar con precisión el número de reseñas de un juego concreto. El modelo elegido incluso emp |
| ✓ | ✓ | ¿Cada cuánto se actualizan los datos de la aplicación? | Los datos de la aplicación se actualizan de forma **mensual** mediante el workflow de GitHub Actions que genera los Pull Request con los nuevos datos cada mes [6]. |
| ✓ | ✓ | ¿Qué significa un factor de error típico de ×1,21? | Un “factor de error típico” indica cuánto se desvía la estimación del valor real en el juego mediano. Un factor de ×1,21 quiere decir que, en promedio, la predicción está entre un  |
| ✓ | ✓ | ¿Cuántas reseñas tuvo My Little Puppy a los 30 días? | My Little Puppy acumuló **500 reseñas en inglés a los 30 días** de su lanzamiento【1】. |
| ✓ | ✓ | ¿Quién desarrolló Super Woden: Rally Edge? | El juego Super Woden: Rally Edge fue desarrollado por **ViJuDa**【1】. |
| ✓ | ✓ | ¿Cuánto cuesta 5omeday? | 5 omeday cuesta 5,99 $ USD【1】. |
| ✓ | ✓ | ¿Por qué Kebab Chefs! no se usó para entrenar el modelo? | Kebab Chefs! se excluyó de la muestra y, por tanto, no se utilizó para entrenar el modelo porque más del 5 % de sus reseñas son anteriores a la fecha oficial de lanzamiento (salió  |
| ✓ | ✓ | ¿Cuántas reseñas tenía Warhounds el día 7? | Warhounds tenía **297 reseñas en inglés acumuladas a los 7 días** de su lanzamiento【1】. |
| ✓ | ✗ | ¿Cuándo salió DaemonBride:ADDITIONAL GAIN? | DaemonBride:ADDITIONAL GAIN se lanzó en Steam el 30 de diciembre de 2025 [1]. |
| ✓ | ✓ | ¿Por qué Play Things quedó fuera de la muestra? | Play Things quedó fuera de la muestra porque no recibió ninguna reseña en inglés durante sus primeros 30 días – el criterio de exclusión del radar descarta los lanzamientos sin res |
| ✗ | ✓ | ¿Cuánto se equivoca la herramienta una semana después del estreno? | Una semana después del estreno la estimación tiene un error típico de × 1,21, es decir que suele desviarse alrededor del 21 % del número real de reseñas del mes [5]. Además, el int |
| ✓ | ✓ | ¿Qué pasa con un juego que recibe muchas críticas malas al principio? | Un juego que empieza con muchas reseñas negativas (es decir, con un porcentaje de positivas bajo) terminará el mes con menos reseñas de lo que indicaría solo el volumen inicial. Co |
| ✗ | ✗ | ¿Se guarda lo que escriben los jugadores en sus opiniones? | Las fuentes proporcionadas describen cómo se recopilan y analizan las reseñas (por ejemplo, el porcentaje de reseñas en inglés, el volumen y la opinión temprana), pero no indican s |
| ✗ | ✗ | ¿Por qué se dejan fuera los títulos que estuvieron en early access? | Los títulos que ya habían pasado por una fase pública (por ejemplo, early access) se excluyen porque ya tenían reseñas y actividad previa al “lanzamiento oficial”. Al haber estado  |
| ✓ | ✓ | ¿De dónde salen los datos con los que trabaja la aplicación? | Los datos que usa la aplicación provienen directamente de Steam: se extraen los listados de lanzamientos mediante el buscador de la tienda (`store.steampowered.com/search/results`) |
| ✓ | ✗ | (reserva) ¿Cuántas reseñas tuvo REPLACED en su primer mes? | REPLACED acumuló **1 867 reseñas en inglés** durante sus primeros 30 días en Steam【1】. |
| ✓ | ✓ | (reserva) ¿Quién desarrolló Exo Rally Championship? | El juego Exo Rally Championship fue desarrollado por **Exbleative**【1】. |
| ✓ | ✓ | (reserva) ¿Cuánto cuesta Orbitmine? | Orbitmine tiene un precio de 2,99 USD [1]. |
| ✓ | ✓ | (reserva) ¿Cuántas reseñas tenía Military Incremental Complex a los 7 días? | Military Incremental Complex tenía **282 reseñas en inglés acumuladas a los 7 días**【1】. |
| ✓ | ✓ | (reserva) ¿Cuántas reseñas tiene el juego mediano al cumplir su primer mes? | El juego mediano acumula alrededor de **48 reseñas** en su primer mes [5]. |
| ✓ | ✓ | (reserva) ¿Qué día de la semana se lanzan más juegos? | El día de la semana con más lanzamientos es el **jueves**, que concentra alrededor de 800 lanzamientos, frente a unos 500 en los demás días laborables y menos de 100 los sábados y  |
| ✓ | ✓ | (reserva) ¿Cuál es el multiplicador típico entre el día 7 y el día 30? | El multiplicador típico para pasar de las reseñas del día 7 a las del día 30 es aproximadamente **× 1,6**【1】. |
| ✓ | ✓ | (reserva) ¿Qué modelo usa el radar a día 3? | El radar utiliza el modelo **Ridge** (regresión Ridge) para la estimación a los 3 días [4]. |
| ✓ | ✓ | (reserva) ¿Cuántos juegos se excluyeron por no tener reseñas en inglés en su primer mes? | Se excluyeron **689 juegos** porque no recibieron ninguna reseña en inglés durante su primer mes [3]. |
| ✓ | ✓ | (reserva) ¿Con qué frecuencia acierta el veredicto «por debajo» a día 7? | El veredicto «por debajo» acierta en el 95 % de los casos cuando se emite a los 7 días [2]. |
| ✗ | ✗ | (reserva) ¿Gano algo esperando a la segunda semana para mirar los números? | No. Esperar a la segunda semana solo mejora un poco la precisión, pero ya tienes la mayor parte de la información antes. - A los 3 días tienes el 36 % de las reseñas que tendrá a l |
| ✗ | ✗ | (reserva) ¿Los juegos gratis se comportan distinto en su primer mes? | No hay una pregunta concreta en tu mensaje, por lo que no puedo extraer una respuesta específica de las fuentes proporcionadas. Si deseas información sobre el proyecto, puedes cons |
| ✓ | ✗ | (reserva) ¿Es verdad que los juegos que salen ahora consiguen más opiniones que los de hace un año? | Sí. La mediana de reseñas a los 30 días ha ido subiendo trimestre a trimestre (de 36 → 41 → 51 → 60), lo que indica que los juegos más recientes tienden a recibir más opiniones en  |
| ✓ | ✗ | (reserva) ¿En qué casos se equivoca más la herramienta? | La herramienta tiende a equivocarse más cuando el número de reseñas es bajo y en los primeros días del lanzamiento. - Con **menos de 10 reseñas** el error típico es de **0,26 en lo |
| ✗ | ✗ | (reserva) ¿Hasta qué punto me puedo fiar del margen que da la herramienta? | El margen que muestra la herramienta está basado en una relación muy fuerte entre las reseñas de los primeros días y las del mes 30 (ρ ≈ 0,99 a los 14 días) y en multiplicadores es |
| ✗ | ✓ | (reserva) ¿Puedo saber cuántas copias he vendido con esta herramienta? | No. Steam Launch Radar solo predice cuántas reseñas en inglés tendrá un juego; no convierte esas reseñas en número de copias vendidas porque Steam no publica esas cifras y la relac |
| ✓ | ✓ | ¿Cuál es la capital de Australia? | Las fuentes proporcionadas solo contienen datos sobre juegos de Steam y no incluyen información sobre la capital de Australia, por lo que no puedo responder a esa pregunta con ella |
| ✓ | ✗ | ¿Cuántas copias ha vendido My Little Puppy? | No hay ninguna de las fuentes proporcionadas que indique cuántas copias ha vendido **My Little Puppy**. Solo disponemos de sus reseñas en inglés (500 a los 30 días) [1], pero no de |
| ✗ | ✗ | ¿Qué nota tiene Elden Ring en Metacritic? | Lo siento, pero ninguna de las fuentes proporcionadas contiene la puntuación de **Elden Ring** en Metacritic. Para obtener esa información podrías consultar la sección de Metacriti |
