import { useState } from 'react';
import { Plus, Minus, BookOpen, LifeBuoy, Plug, PenLine, Rocket } from 'lucide-react';
import { DOCS_BASE } from '../lib/constants.js';
import { PageHeader } from '../components/ui.jsx';

const FAQ = [
  {
    q: '¿Por qué tiene que estar encendido mi ordenador?',
    a: 'WillyPost vive en tu ordenador: no hay servidores de por medio y por eso es gratis y tus claves son solo tuyas. A la hora programada, WillyPost envía la publicación a la red. Si el ordenador está apagado o dormido, no puede. Cuando lo enciendas, te preguntará qué hacer con lo que se quedó sin publicar: publicar ahora, reprogramar u omitir.',
  },
  {
    q: '¿Por qué tengo que reconectar mis redes cada 30 días?',
    a: 'Las redes dan permisos temporales a las aplicaciones. Para mantener todo seguro, WillyPost renueva la conexión cada 30 días: desde el día 25 verás un aviso y en Redes pulsas “Reconectar” (son dos clics). Si pasan los 30 días, la cuenta queda caducada, no publica y sus envíos pendientes fallan con el mensaje “Reconecta tu cuenta”.',
  },
  {
    q: '¿Por qué hay un límite de 5 publicaciones al día?',
    a: 'Para proteger tus cuentas. Las redes penalizan o bloquean a quien publica en exceso desde herramientas externas. WillyPost permite 5 publicaciones de feed (post, carrusel y reel) y 10 stories por cuenta y día natural. El calendario te muestra el contador de cada día (por ejemplo 3/5) y no te dejará pasarte.',
  },
  {
    q: '¿Qué es el modo manual?',
    a: 'Es tu red de seguridad. Si una red no está conectada, o su API no permite ese tipo de contenido (por ejemplo, carruseles en TikTok o stories en Threads), la publicación va en modo manual: a su hora recibes una notificación y en “Para publicar a mano” tienes el texto para copiar, los archivos para descargar y un botón para abrir la red. Cuando la subes, pulsas “Ya lo he publicado”.',
  },
  {
    q: '¿Por qué mis vídeos de TikTok salen privados o van a la bandeja?',
    a: 'TikTok exige que audite cada aplicación antes de permitir publicaciones públicas directas. Mientras tu app no esté auditada, WillyPost puede enviar el vídeo a tu bandeja de TikTok (lo terminas y lo publicas desde el móvil) o publicarlo como privado. Es una norma de TikTok, no de WillyPost.',
  },
  {
    q: '¿Por qué Google Business Profile pide aprobación?',
    a: 'La API de Google Business Profile no es de uso libre: hay que solicitar el acceso a Google y esperar su aprobación (puede tardar unos días). Mientras tanto puedes usar tu ficha en modo manual. En la guía de la red te explicamos cómo pedir el acceso.',
  },
  {
    q: '¿Dónde se guardan mis datos y mis claves?',
    a: 'Solo en tu ordenador, en la carpeta de datos de WillyPost (por ejemplo %APPDATA%\\WillyPost en Windows). Nada se envía a la Academia ni a terceros. Por eso no hay “recuperar contraseña por email”: guarda bien tu código de recuperación.',
  },
  {
    q: '¿Qué hago si una publicación falla?',
    a: 'Ábrela desde el calendario o la lista: verás el motivo en español junto a cada red y un botón “Reintentar”. Los fallos más habituales son una conexión caducada (reconecta en Redes) o un archivo que la red no acepta (cambia el formato o el tamaño).',
  },
];

export default function Help() {
  const [open, setOpen] = useState(0);
  return (
    <div>
      <PageHeader eyebrow="Centro de ayuda" title="Preguntas" pill="frecuentes" sub="Lo que más nos preguntan los alumnos de la Academia." />
      <div className="card help-start">
        <h3>Empieza en 3 pasos</h3>
        <ol>
          <li><span><Plug size={18} /></span><div><b>Conecta una red.</b> En <a href="#/redes">Redes</a> sigue el asistente de tu carné, o añádela en modo manual si no quieres configurar nada.</div></li>
          <li><span><PenLine size={18} /></span><div><b>Crea tu primera publicación.</b> Pulsa “Crear publicación”, escribe el texto, añade una imagen y elige las redes.</div></li>
          <li><span><Rocket size={18} /></span><div><b>Prográmala y deja WillyPost abierto.</b> A la hora elegida se publica sola. Si es modo manual, te aviso para que la subas tú.</div></li>
        </ol>
      </div>
      <div className="help-layout">
        <div className="faq">
          {FAQ.map((f, i) => (
            <div key={f.q} className={`faq-item ${open === i ? 'open' : ''}`}>
              <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                <span>{f.q}</span>
                <i>{open === i ? <Minus size={16} /> : <Plus size={16} />}</i>
              </button>
              {open === i && <div className="faq-a"><p>{f.a}</p></div>}
            </div>
          ))}
        </div>
        <aside className="card help-side">
          <h3>¿Sigues atascado?</h3>
          <p>Cada red tiene una guía con capturas para crear tu carné paso a paso.</p>
          <a className="btn btn-secondary" href={DOCS_BASE} target="_blank" rel="noreferrer"><BookOpen size={18} /> Ver las guías</a>
          <p className="mt">También puedes preguntarlo en la comunidad de la Willy SEO Academy.</p>
          <div className="help-hint"><LifeBuoy size={18} /> Cuéntanos qué red y qué mensaje de error ves y te ayudamos.</div>
        </aside>
      </div>
    </div>
  );
}
