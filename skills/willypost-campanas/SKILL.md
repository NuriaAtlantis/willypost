---
name: willypost-campanas
description: Úsala siempre que el usuario pida una campaña de redes sociales, un calendario de contenidos, una parrilla de publicaciones o que le programes posts, reels, carruseles o stories en WillyPost (Instagram, Facebook, TikTok, Google Business Profile, YouTube Shorts, LinkedIn, Threads, Bluesky). Guía el método completo con las herramientas MCP de WillyPost, desde preguntar el objetivo hasta dejar las piezas creadas.
---

# Campañas en WillyPost

Método para montar una campaña de redes con las herramientas MCP de WillyPost (`willypost_status`, `get_network_specs`, `get_free_slots`, `get_calendar`, `upload_media`, `create_campaign`, `create_post`, `update_post`, `delete_post`). Habla en español de España, tuteando, con frases cortas.

## 0. Antes de nada

1. Llama a `willypost_status`. Te da la hora local, las cuentas conectadas, su estado y el modo de Claude.
   - Si responde que WillyPost no está abierto, dile al usuario que haga doble clic en el icono de WillyPost y reintenta.
   - Cuentas `expired` o `error`: avísale de que hay que reconectarlas en WillyPost > Redes. No planifiques para ellas.
   - Modo `draft` (por defecto): todo lo que crees llega como borrador "Propuesto por Claude" y el usuario lo aprueba. Modo `schedule`: se programa directamente.
2. Trabaja SOLO con las redes que el usuario tiene conectadas (o en modo manual). Si pide una red que no tiene, dilo y propón conectarla.

## 1. Pregunta lo que falte (una sola vez, todo junto)

Si no lo ha dicho, pregunta como máximo estas cosas:
- **Objetivo**: ¿vender un curso o servicio, captar leads, ganar autoridad, llenar una fecha concreta?
- **Público**: a quién le hablamos y qué problema tiene.
- **Oferta y CTA**: qué ofrecemos, precio o promo si procede, y a dónde enviamos (web, formulario, WhatsApp, reserva).
- **Fechas**: inicio, duración, fechas clave (lanzamiento, cierre de plazas, evento).
- **Medios**: qué fotos o vídeos tiene ya (rutas en su ordenador) y si puede grabar más.
- **Tono y cosas a evitar**.

Si ya hay datos suficientes, no preguntes: avanza y deja los supuestos por escrito en el plan.

## 2. Mira el terreno

- `get_network_specs` (por red): formatos, tamaños, límites de texto, hashtags y qué tipos van por API y cuáles irán a **modo manual**.
- `get_calendar` del rango: qué hay ya publicado o programado, para no solapar ni repetir.
- `get_free_slots` del rango: huecos por cuenta y día.

**Límites duros por cuenta y día natural: 5 publicaciones de feed (post + carrusel + reel) y 10 stories.** Los borradores no cuentan hasta aprobarse, así que respétalos tú al planificar (`create_post` y `create_campaign` ya te avisan si un día está lleno y no crean esa pieza). Un ritmo sano es mucho menos: 1 pieza de feed al día por red como máximo en campañas normales.

Zona horaria: usa la hora local del usuario (la que da `willypost_status`) y manda `scheduled_at` en ISO **con desfase**, por ejemplo `2026-11-03T09:30:00+01:00`. Nunca en UTC "a ojo" ni sin desfase. Las fechas deben ser futuras. Evita horas redondas repetidas en varias redes a la vez: escalona 15-30 minutos.

## 3. Diseña el mix de contenido

Reparte por **etapa del embudo** y por **formato**, y adapta cada pieza a cada red (no copies lo mismo en todas):

| Etapa | Objetivo | Formatos que mejor funcionan |
|---|---|---|
| Atraer | Que te descubran | Reels y TikToks con gancho, carruseles "X errores / X pasos", posts de opinión en LinkedIn/Threads |
| Educar | Demostrar que sabes | Carruseles didácticos, reels tipo mini-clase, hilos cortos, casos reales |
| Convencer | Quitar dudas | Testimonios, antes/después, preguntas frecuentes, detrás de cámaras, stories con prueba social |
| Convertir | Pedir la acción | Post/reel con oferta y CTA directa, cuenta atrás, últimas plazas, stories de recordatorio |

Reglas prácticas:
- Reels/vídeo vertical 9:16 para alcance (Instagram, TikTok, YouTube Shorts, Facebook, LinkedIn y Bluesky también aceptan vídeo).
- Carruseles para guardados y enseñar (Instagram, hasta 20 imágenes, y LinkedIn; en TikTok irían a manual).
- Stories para recordatorios y cercanía (solo Instagram y Facebook por API; en otras redes serían manuales).
- Google Business Profile: 1 novedad por semana, texto + 1 foto, sin hashtags.
- Alterna: no pongas dos piezas de "vender" seguidas. Orientativo: 60 % educar/atraer, 25 % convencer, 15 % convertir, subiendo la presión de venta al acercarse el cierre.
- Una semana tipo para una red principal: 3 piezas de feed + stories de apoyo los días de oferta.

Si el usuario tiene pocos medios, propón primero lo que puede hacer solo con texto/imagen (posts, carruseles) y marca qué vídeos grabar.

## 4. Escribe textos nativos por red

Para cada pieza escribe el **texto base** y, cuando proceda, un texto propio por red en `captions_by_network`. Mira siempre `get_network_specs` para los límites.

- **Gancho en la primera línea** (se corta tras 1-2 líneas): pregunta, dato, promesa concreta o error común. Nada de "Hoy te cuento…".
- **Una idea por pieza** y una **CTA clara** al final (comenta, guarda, escribe "SEO" por DM, reserva en el enlace…).
- **Instagram**: cercano, párrafos cortos, 3-5 hashtags específicos al final; el enlace del texto no es clicable (di "enlace en bio" o pide DM).
- **TikTok**: primera frase = gancho hablado y texto en pantalla; 3-5 hashtags; lenguaje de búsqueda (palabras clave que la gente teclea).
- **LinkedIn**: profesional pero humano, frases cortas con líneas en blanco, hasta 3.000 caracteres, 3-5 hashtags.
- **Facebook**: corto y conversacional; el enlace sí es clicable.
- **Threads / Bluesky**: breve (500 / 300 caracteres), tono de conversación, 0-1 hashtags.
- **YouTube Shorts**: título **obligatorio** con la palabra clave primero (≤ 100 caracteres, en `options_by_network.youtube.title`) + `#Shorts`, y visibilidad **obligatoria** en `options_by_network.youtube.privacy` (`public`, `unlisted` o `private`; propón una y el usuario la revisa). Sin título o sin visibilidad la pieza queda como borrador.
- **Google Business Profile (ángulo SEO local)**: son alumnos de SEO, así que aprovecha la ficha. Texto de 150-300 palabras como máximo, **servicio + ciudad/zona** de forma natural en las primeras líneas, novedad u oferta concreta, y botón (`options_by_network.gbp.cta`: LEARN_MORE, BOOK, CALL…) con una URL a la página de servicio correspondiente. Sin hashtags ni emojis en exceso. Una foto real del negocio, no stock.
- Si el usuario tiene guía de estilo o ejemplos de textos suyos, imítalos.

## 5. Medios

- Si el usuario te da archivos, pide la **ruta absoluta** y súbelos con `upload_media` ANTES de crear piezas. Guarda los `media_id`. Valen espacios y tildes en la ruta. Si te da la ruta de una **carpeta**, `upload_media` sube todas las imágenes y vídeos que contiene (por orden alfabético) y te devuelve un `media_id` por archivo: pregunta qué foto va en qué pieza si no está claro. No intentes leer ni listar su disco por otra vía.
- `list_media` para reutilizar lo ya subido.
- Tipo y medios deben encajar: `post` = 0-1 imagen, `carousel` = 2 o más imágenes, `reel` = 1 vídeo, `story` = 1 imagen o vídeo.
- Si falta un medio para una pieza, créala igualmente como borrador sin `scheduled_at` o sin ese medio y anota en `notes` qué hay que grabar o diseñar.

## 6. Enséñale el plan y pide OK

Antes de crear nada, muestra una tabla compacta:

| # | Fecha y hora | Red(es) | Tipo | Tema / gancho | Medio |
|---|---|---|---|---|---|

Añade 2-3 líneas con la lógica de la campaña y los supuestos. Pregunta si lo crea tal cual. Si el usuario ya dijo "créalo directamente", sáltate este paso.

## 7. Créalo

- Usa **`create_campaign`** con todas las piezas (nombre claro, descripción con el objetivo). Cada pieza: `type`, `caption`, `networks`, `captions_by_network`, `media_ids`, `scheduled_at` (ISO con desfase), `notes`.
- `create_campaign` no se detiene por errores: devuelve las piezas creadas y las incidencias. Corrige las incidencias (límite diario → mueve de día con `get_free_slots`; red no conectada; medio inexistente) y créalas con `create_post` usando `campaign` con el id de la campaña.
- Para cambios posteriores usa `update_post`; para quitar piezas, `delete_post` (solo si no están publicadas, y confirma antes de borrar algo que no creaste tú).
- Si una red no admite el tipo por API (p. ej. carrusel en TikTok, story en Threads), la pieza se crea en **modo manual**: avisa al usuario de que a su hora saltará una notificación para publicarla a mano.
- **TikTok (reglas de TikTok)**: tú NO eliges la privacidad («quién puede verlo»), ni permitir comentarios/dúos/stitch, ni la divulgación de contenido comercial («Tu marca» / «Contenido de marca»): no los pongas en `options_by_network.tiktok` (da error). Solo puedes indicar `tiktok_mode` (`direct` o `inbox`). Las piezas de TikTok en modo directo quedan como borrador **"Propuesto por Claude"** aunque lleven fecha: en el resumen dile al usuario que las abra en WillyPost, elija esas opciones y pulse **Programar**. Nunca añadas marcas de agua, logos ni el nombre de WillyPost al vídeo o a las fotos.

## 8. Cierra con resumen y recordatorios

Termina siempre con:
1. Una **tabla resumen** de lo creado (id, fecha local, red, tipo, estado) y de las incidencias pendientes.
2. Este recordatorio, adaptado al modo:
   - Modo `draft`: "Las piezas están como borradores **'Propuesto por Claude'**. Entra en WillyPost, revísalas y pulsa **Aprobar** para programarlas."
   - Modo `schedule`: "Ya están programadas. Revísalas en el calendario de WillyPost."
3. Que el **ordenador debe estar encendido** a la hora de publicar (si no, WillyPost te preguntará qué hacer con las perdidas) y que las conexiones de las redes se **reconectan cada 30 días**.
4. Los envíos en modo manual, si los hay.
5. Si hay piezas de TikTok en modo directo: "En TikTok tienes que abrir cada pieza y elegir tú quién puede verla, si permites comentarios, dúos y stitch, y si es contenido comercial. Después pulsa **Programar**."

## Lo que NO puedes hacer (lo hace el alumno)

Aprobar borradores, publicar al momento, reintentar envíos fallidos, cambiar el modo de Claude o los ajustes, ni tocar cuentas o claves. En modo `draft` solo puedes proponer. Si una herramienta devuelve un error 403 o 409, **cuéntaselo al alumno con las mismas palabras del mensaje** (no lo reformules ni insistas) y dile qué hacer en WillyPost: por ejemplo, "entra en WillyPost y pulsa Aprobar" o "elige otro día, ese está lleno".

## Errores típicos que debes evitar

- Fechas sin desfase o en el pasado.
- Más de 5 piezas de feed o 10 stories al día en una misma cuenta.
- Mismo texto copiado en todas las redes.
- Hashtags en Google Business Profile, o más de 1 en Threads/Bluesky.
- Pasarse de longitud (Bluesky 300, Threads 500, LinkedIn 3.000, GBP 1.500, Instagram/TikTok 2.200).
- Crear piezas antes de subir los medios.
- Inventar cuentas o redes que el usuario no tiene conectadas.
