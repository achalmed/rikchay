/**
 * FOTOTECA — tipos, llamadas y geometría compartidos por la página, el visor, el
 * editor y el selector (2026-10-06; backend/app/api/fototeca.py).
 *
 * La geometría de los ajustes es la MISMA de backend/app/servicios/fototeca.py
 * (girar → voltear → enderezar → recortar): lo que el editor muestra en su lienzo
 * es lo que sale al exportar. Si cambia allá, cambia aquí.
 */
import { api, cerrarSesion, PALETA, token } from '@qillqa/tiqsi'

export type Estado = 'por_revisar' | 'publica' | 'reservada'
/** La depuración de digiKam (2026-10-19): '' = sin marca. */
export type Seleccion = '' | 'aceptada' | 'pendiente' | 'rechazada'

export interface Ajustes {
  rotar?: number
  voltear?: boolean
  voltear_v?: boolean
  enderezar?: number
  /** [x, y, ancho, alto] relativos (0–1) al encuadre ya girado y enderezado. */
  recorte?: [number, number, number, number]
  brillo?: number
  contraste?: number
  saturacion?: number
}

export interface Vinculo {
  tipo: 'semana' | 'proyecto' | 'documento'
  id: number
  codigo?: string
  etiqueta?: string
  seleccion?: boolean
}

export interface Foto {
  id: number
  /** 'video' (2026-10-06): se reproduce en el visor; no se edita ni se exporta por tamaños.
   *  'documento' (2026-10-19): un activo de marca sin vista (PDF, Illustrator); se descarga. */
  medio?: 'foto' | 'video' | 'documento'
  /** Segundos (solo videos). */
  duracion?: number | null
  nombre_original: string
  ancho: number
  alto: number
  /** Ancho/alto tras los ajustes (para la cuadrícula). */
  proporcion: number
  bytes: number
  tomada_en: string | null
  fecha_exif: boolean
  camara: string
  lat: number | null
  lon: number | null
  titulo: string
  descripcion: string
  lugar: string
  /** El lugar con nombre (mapa) en que está, si está en uno; su nombre va en `lugar`. */
  lugar_id?: number | null
  etiquetas: string[]
  personas: string[]
  estado: Estado
  favorita: boolean
  calificacion: number
  album_id: number | null
  ajustes: Ajustes
  /** Huella de los ajustes: va en la dirección de la miniatura y la vista. */
  version: string
  vinculos: Vinculo[]
  eliminada_en: string | null
  /** Mediateca central (2026-10-19): su archivo («2026/20261018_182530.jpg», «marca/logo/…»), si es de una
   *  actividad o de la marca y, en la marca, su categoría. */
  archivo?: string
  ambito?: 'actividad' | 'marca' | 'prensa'
  categoria?: string
  fecha_fuente?: string
  /** Cuántas versiones editadas tiene este original (2026-10-19); y, en una versión, de qué tipo es y cuándo se hizo. */
  n_versiones?: number
  version_de?: { tipo: string; ajustes: Ajustes; creado_en: string | null }
  /** Depuración y etiqueta de color, como en digiKam ('' = sin marca). */
  seleccion?: Seleccion
  color?: string
  // Solo en el detalle.
  exif?: Record<string, string>
  sha256?: string
  creado_en?: string
  subido_por_nombre?: string
}

/** Un lugar con nombre (2026-10-19): centro, radio y cuántas fotos tiene. */
export interface Lugar {
  id: number
  nombre: string
  lat: number | null
  lon: number | null
  radio_m: number
  n: number
}

export interface Album {
  id: number
  nombre: string
  descripcion: string
  fecha: string
  portada_id: number | null
  n: number
}

export interface Facetas {
  total: number
  por_revisar: number
  favoritas: number
  sin_album: number
  papelera: number
  videos?: number
  albumes: Album[]
  etiquetas: { valor: string; n: number }[]
  personas: { valor: string; n: number }[]
  meses: { mes: string; n: number }[]
  vinculos: { tipo: string; id: number; etiqueta: string; n: number }[]
  /** Los activos de marca por categoría (logo, retrato, recurso, marco, color). */
  marca?: { categoria: string; n: number }[]
  /** Lo que produce Prensa (2026-10-20) por formato (post, historia, portada, video). */
  prensa?: { categoria: string; n: number }[]
  /** Cuántas hay aceptadas, pendientes, rechazadas y sin marca («ninguna»). */
  seleccion?: Record<string, number>
  colores?: { color: string; n: number }[]
}

/** Las categorías de la marca, en el orden del panel. */
export const CATEGORIAS_MARCA: { clave: string; etiqueta: string }[] = [
  { clave: 'logo', etiqueta: 'Logotipos' },
  { clave: 'retrato', etiqueta: 'Retratos' },
  { clave: 'recurso', etiqueta: 'Recursos institucionales' },
  { clave: 'marco', etiqueta: 'Marcos y superposiciones' },
  { clave: 'color', etiqueta: 'Color' },
]

/** Los formatos de Prensa (2026-10-20), en el orden del panel. */
export const FORMATOS_PRENSA: { clave: string; etiqueta: string }[] = [
  { clave: 'post', etiqueta: 'Posts' },
  { clave: 'historia', etiqueta: 'Historias' },
  { clave: 'portada', etiqueta: 'Portadas' },
  { clave: 'video', etiqueta: 'Videos' },
]

export interface Pagina {
  fotos: Foto[]
  total: number
  siguiente: number | null
}

export const ESTADOS: { valor: Estado; etiqueta: string; color: string }[] = [
  { valor: 'por_revisar', etiqueta: 'Por revisar', color: PALETA.aviso },
  { valor: 'publica', etiqueta: 'Pública', color: PALETA.exito },
  { valor: 'reservada', etiqueta: 'Reservada', color: PALETA.textoTenue },
]
/** La depuración, en el orden de digiKam (Alt+3, Alt+2, Alt+1; Alt+0 quita la marca). */
export const SELECCIONES: { valor: Exclude<Seleccion, ''>; etiqueta: string; plural: string; color: string; tecla: string }[] = [
  { valor: 'aceptada', etiqueta: 'Aceptada', plural: 'Aceptadas', color: PALETA.exito, tecla: '3' },
  { valor: 'pendiente', etiqueta: 'Pendiente', plural: 'Pendientes', color: PALETA.aviso, tecla: '2' },
  { valor: 'rechazada', etiqueta: 'Rechazada', plural: 'Rechazadas', color: PALETA.error, tecla: '1' },
]
/** Alt+0…3 → la selección que marca (null = no es un atajo de depuración). */
export function seleccionDeTecla(e: KeyboardEvent): Seleccion | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null
  const d = /^Digit([0-3])$/.exec(e.code)?.[1]
  if (d === undefined) return null
  return d === '0' ? '' : (SELECCIONES.find((s) => s.tecla === d)?.valor ?? null)
}

/** Las etiquetas de color (las de digiKam); tonos apagados, iguales en los dos modos: van sobre la foto. */
export const COLORES: { valor: string; etiqueta: string; hex: string }[] = [
  { valor: 'rojo', etiqueta: 'Rojo', hex: '#C8524E' },
  { valor: 'naranja', etiqueta: 'Naranja', hex: '#C98A4B' },
  { valor: 'amarillo', etiqueta: 'Amarillo', hex: '#C9B04B' },
  { valor: 'verde', etiqueta: 'Verde', hex: '#5E9A63' },
  { valor: 'azul', etiqueta: 'Azul', hex: '#4F7FC0' },
  { valor: 'magenta', etiqueta: 'Magenta', hex: '#A35A9A' },
  { valor: 'gris', etiqueta: 'Gris', hex: '#8E8E93' },
  { valor: 'negro', etiqueta: 'Negro', hex: '#2C2C2E' },
  { valor: 'blanco', etiqueta: 'Blanco', hex: '#F2F2F2' },
]
export const hexColor = (c: string | undefined) => COLORES.find((x) => x.valor === c)?.hex

export const etiquetaEstado = (e: string) => ESTADOS.find((x) => x.valor === e)?.etiqueta ?? e

export const PRESETS: { clave: string; etiqueta: string; proporcion: number | null }[] = [
  { clave: 'original', etiqueta: 'Original con ajustes', proporcion: null },
  { clave: 'documento', etiqueta: 'Documento (2400 px)', proporcion: null },
  { clave: 'informe', etiqueta: 'Informe 3:2', proporcion: 3 / 2 },
  { clave: 'publicacion', etiqueta: 'Publicación 4:5', proporcion: 4 / 5 },
  { clave: 'cuadrada', etiqueta: 'Cuadrada 1:1', proporcion: 1 },
  { clave: 'historia', etiqueta: 'Historia 9:16', proporcion: 9 / 16 },
]

export const ORDENES = [
  { valor: 'reciente', etiqueta: 'Más recientes' },
  { valor: 'antigua', etiqueta: 'Más antiguas' },
  { valor: 'subida', etiqueta: 'Últimas subidas' },
  { valor: 'calificacion', etiqueta: 'Mejor calificadas' },
  { valor: 'nombre', etiqueta: 'Por nombre de archivo' },
]

export const RUTA_VINCULO: Record<Vinculo['tipo'], (id: number) => string> = {
  semana: (id) => `/informes/${id}`,
  proyecto: (id) => `/proyectos/${id}`,
  documento: (id) => `/documentos/${id}`,
}
export const NOMBRE_VINCULO: Record<Vinculo['tipo'], string> = {
  semana: 'Semana de representación',
  proyecto: 'Proyecto de ley',
  documento: 'Documento',
}

export const urlMiniatura = (f: Pick<Foto, 'id' | 'version'>) => `/api/fototeca/${f.id}/miniatura?v=${f.version}`
export const urlVista = (f: Pick<Foto, 'id' | 'version'>) => `/api/fototeca/${f.id}/vista?v=${f.version}`
export const urlCruda = (id: number) => `/api/fototeca/${id}/vista?crudo=1`

export const esVideo = (f: Pick<Foto, 'medio'>) => f.medio === 'video'

/** «1:05», «12:30», «1:02:03». */
export function duracionLegible(segundos: number | null | undefined): string {
  if (!segundos || segundos < 0) return ''
  const s = Math.round(segundos)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** Extensiones que acepta la subida (fotos y videos). */
export const ACEPTA = 'image/*,.heic,.heif,video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm'

// --- Imágenes autenticadas -------------------------------------------------------------------

const autorizacion = (): Record<string, string> => (token() ? { Authorization: `Bearer ${token()}` } : {})

// Las imágenes piden token, así que no sirve un <img src> directo: se bajan como
// blob y se guardan aquí (las direcciones llevan la versión de los ajustes, así
// que una entrada nunca queda vieja). Se limita el número para no acumular memoria.
const imagenes = new Map<string, Promise<string>>()
const MAX_IMAGENES = 600

export function traerImagen(ruta: string): Promise<string> {
  const hay = imagenes.get(ruta)
  if (hay) {
    imagenes.delete(ruta)
    imagenes.set(ruta, hay) // la más usada pasa al final
    return hay
  }
  const promesa = fetch(ruta, { headers: autorizacion() }).then(async (r) => {
    if (r.status === 401) cerrarSesion()
    if (!r.ok) throw new Error(`No se pudo traer la imagen (${r.status}).`)
    return URL.createObjectURL(await r.blob())
  })
  promesa.catch(() => imagenes.delete(ruta))
  imagenes.set(ruta, promesa)
  while (imagenes.size > MAX_IMAGENES) {
    const [vieja, p] = imagenes.entries().next().value as [string, Promise<string>]
    imagenes.delete(vieja)
    void p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
  }
  return promesa
}

/** Baja un archivo a la carpeta de descargas del navegador. */
export function bajar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function nombreDe(cd: string | null, defecto: string): string {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd ?? '') ?? /filename="?([^";]+)"?/i.exec(cd ?? '')
  try {
    return m ? decodeURIComponent(m[1]) : defecto
  } catch {
    return m ? m[1] : defecto
  }
}

/** Exporta una o varias fotos (con sus ajustes) en un tamaño: una sola → su archivo; varias → .zip. */
export async function exportar(ids: number[], preset: string): Promise<{ blob: Blob; nombre: string }> {
  const r = await fetch('/api/fototeca/exportar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...autorizacion() },
    body: JSON.stringify({ ids, preset }),
  })
  if (r.status === 401) cerrarSesion()
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => null)
    throw new Error((cuerpo as { detail?: string } | null)?.detail ?? `No se pudo exportar (${r.status}).`)
  }
  return { blob: await r.blob(), nombre: nombreDe(r.headers.get('content-disposition'), ids.length > 1 ? 'fototeca.zip' : 'foto.jpg') }
}

export interface ResultadoSubida {
  nuevas: Foto[]
  duplicadas: { nombre: string; id: number; en_papelera: boolean }[]
  rechazadas: { nombre: string; motivo: string }[]
  /** Archivos iguales elegidos dos veces en la misma tanda (se sube uno). */
  repetidas_en_seleccion?: number
  /** Si eran de una Semana de Representación: lo que registró la semana. */
  semana?: { fotos: string[]; repetidas: number[] } | null
}

/** Cómo va una subida: primero se revisan las huellas, luego se envía lo que falta. */
export interface AvanceSubida {
  fase: 'revisando' | 'subiendo'
  /** Archivos ya resueltos (revisados, o subidos / ya estaban / fallaron). */
  listos: number
  archivos: number
  /** Bytes enviados de los que había que enviar. */
  enviado: number
  total: number
  yaEstaban: number
  fallaron: number
}

/** Más grande que esto no se lee entero en el navegador para su huella: lo resuelve el servidor. */
const HUELLA_MAXIMA = 300 * 1024 * 1024
const EN_PARALELO = 3
const INTENTOS = 4

/** SHA-256 del archivo, la misma huella que guarda el servidor; null si el navegador no puede
 *  (sin `crypto.subtle` fuera de HTTPS, o un video enorme). */
async function huellaDe(a: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle || a.size > HUELLA_MAXIMA) return null
  try {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await a.arrayBuffer()))
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/** Corre `tarea` sobre cada elemento con `n` a la vez, en orden de llegada. */
async function enParalelo<T>(lista: T[], n: number, tarea: (x: T, i: number) => Promise<void>): Promise<void> {
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < lista.length) {
      const i = siguiente++
      await tarea(lista[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, trabajador))
}

class ErrorSubida extends Error {
  constructor(mensaje: string, readonly estado: number) {
    super(mensaje)
  }
  /** La red, el servidor caído o saturado: vale la pena reintentar. Un 4xx no cambia al repetir. */
  get reintentable() { return this.estado === 0 || this.estado >= 500 || this.estado === 429 }
}

function enviarUno(a: File, extra: Record<string, string>, alAvanzar: (enviado: number) => void): Promise<ResultadoSubida> {
  const datos = new FormData()
  datos.append('archivos', a)
  for (const [k, v] of Object.entries(extra)) datos.append(k, v)
  return new Promise<ResultadoSubida>((resolver, rechazar) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/fototeca/subir')
    const tk = token()
    if (tk) xhr.setRequestHeader('Authorization', `Bearer ${tk}`)
    xhr.upload.onprogress = (e) => alAvanzar(e.lengthComputable ? e.loaded : 0)
    xhr.onload = () => {
      if (xhr.status === 401) cerrarSesion()
      let cuerpo: unknown = null
      try {
        cuerpo = JSON.parse(xhr.responseText)
      } catch {
        /* sin JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolver(cuerpo as ResultadoSubida)
      const detalle = (cuerpo as { detail?: string } | null)?.detail
      rechazar(new ErrorSubida(typeof detalle === 'string' ? detalle : `Error ${xhr.status}`, xhr.status))
    }
    xhr.onerror = () => rechazar(new ErrorSubida('Se cortó la conexión con el servidor.', 0))
    xhr.ontimeout = () => rechazar(new ErrorSubida('El servidor tardó demasiado.', 0))
    xhr.send(datos)
  })
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Sube fotos como Google Fotos (2026-10-20, Edison: «900 fotos y se quedó en 3 %… que identifique
 * los duplicados al subir»):
 *   1. calcula en el navegador la huella de cada archivo y pregunta cuáles ya están
 *      (`/api/fototeca/existen`): lo que ya está no se envía, y elegir dos veces lo mismo tampoco;
 *   2. envía una foto por petición, tres a la vez; una que falla por la red o el servidor se
 *      reintenta y, si no hay caso, se informa sin detener las demás.
 * Volver a elegir las mismas 900 tras un corte retoma donde quedó: lo subido sale «ya estaba».
 * Con un álbum o una semana elegidos, las que ya estaban entran igual en ellos (`/asociar`).
 */
export async function subirFotos(
  archivos: File[],
  albumId: number | null,
  alAvanzar: (a: AvanceSubida) => void,
  /** Fotos de una Semana de Representación: van también a su banco de trabajo y a su actividad. */
  semana?: { id: number; actividad: string } | null,
): Promise<ResultadoSubida> {
  const salida: ResultadoSubida = { nuevas: [], duplicadas: [], rechazadas: [], repetidas_en_seleccion: 0, semana: null }
  const av: AvanceSubida = { fase: 'revisando', listos: 0, archivos: archivos.length, enviado: 0, total: 0, yaEstaban: 0, fallaron: 0 }
  alAvanzar({ ...av })

  // 1. Huellas (de a cuatro: leer el archivo es lo que tarda) y lo que ya está.
  const huellas: (string | null)[] = new Array(archivos.length).fill(null)
  await enParalelo(archivos, 4, async (a, i) => {
    huellas[i] = await huellaDe(a)
    av.listos++
    alAvanzar({ ...av })
  })
  const vistas = new Set<string>()
  const porEnviar: File[] = []
  const porPreguntar = new Map<string, File>()
  archivos.forEach((a, i) => {
    const h = huellas[i]
    if (!h) return porEnviar.push(a)
    if (vistas.has(h)) return void salida.repetidas_en_seleccion!++
    vistas.add(h)
    porPreguntar.set(h, a)
  })
  const lista = [...porPreguntar.keys()]
  for (let i = 0; i < lista.length; i += 1000) {
    let ya: Record<string, { id: number; en_papelera: boolean }> = {}
    try {
      ya = (await api<{ existen: typeof ya }>('/api/fototeca/existen', { method: 'POST', body: JSON.stringify({ sha256: lista.slice(i, i + 1000) }) })).existen
    } catch {
      /* sin la consulta, se envían: el servidor igual reconoce las repetidas */
    }
    for (const h of lista.slice(i, i + 1000)) {
      const a = porPreguntar.get(h)!
      if (ya[h]) salida.duplicadas.push({ nombre: a.name, id: ya[h].id, en_papelera: ya[h].en_papelera })
      else porEnviar.push(a)
    }
  }
  const ordenOriginal = new Map(archivos.map((a, i) => [a, i]))
  porEnviar.sort((x, y) => ordenOriginal.get(x)! - ordenOriginal.get(y)!)

  const extra: Record<string, string> = {}
  if (albumId) extra.album_id = String(albumId)
  if (semana) {
    extra.semana_id = String(semana.id)
    extra.actividad = semana.actividad
  }
  const sumarSemana = (s: ResultadoSubida['semana']) => {
    if (!s) return
    salida.semana = { fotos: [...(salida.semana?.fotos ?? []), ...s.fotos], repetidas: [...(salida.semana?.repetidas ?? []), ...s.repetidas] }
  }
  // Las que ya estaban, al álbum o la semana elegidos (antes de subir: así el álbum de la
  // actividad se crea una sola vez).
  const yaEstaban = salida.duplicadas.filter((d) => !d.en_papelera).map((d) => d.id)
  if ((albumId || semana) && yaEstaban.length) {
    try {
      const r = await api<{ semana: ResultadoSubida['semana'] }>('/api/fototeca/asociar', {
        method: 'POST',
        body: JSON.stringify({ ids: yaEstaban, album_id: albumId, semana_id: semana?.id ?? null, actividad: semana?.actividad ?? '' }),
      })
      sumarSemana(r.semana)
    } catch {
      /* quedan en la Mediateca; se pueden mover desde ahí */
    }
  }

  // 2. Envío.
  av.fase = 'subiendo'
  av.listos = salida.duplicadas.length + salida.repetidas_en_seleccion!
  av.yaEstaban = av.listos
  av.total = porEnviar.reduce((s, a) => s + a.size, 0)
  alAvanzar({ ...av })
  const enCurso = new Map<File, number>()
  let terminado = 0
  const avisar = () => {
    av.enviado = terminado + [...enCurso.values()].reduce((s, n) => s + n, 0)
    alAvanzar({ ...av })
  }
  let sesionCerrada = false
  const una = async (a: File) => {
    if (sesionCerrada) return
    for (let intento = 1; ; intento++) {
      try {
        const r = await enviarUno(a, extra, (n) => { enCurso.set(a, n); avisar() })
        salida.nuevas.push(...r.nuevas)
        salida.duplicadas.push(...r.duplicadas)
        salida.rechazadas.push(...r.rechazadas)
        av.yaEstaban += r.duplicadas.length
        av.fallaron += r.rechazadas.length
        sumarSemana(r.semana)
        break
      } catch (e) {
        const reintentable = e instanceof ErrorSubida ? e.reintentable : true
        if (e instanceof ErrorSubida && e.estado === 401) sesionCerrada = true
        if (!reintentable || intento >= INTENTOS || sesionCerrada) {
          salida.rechazadas.push({ nombre: a.name, motivo: e instanceof Error ? e.message : 'No se pudo subir.' })
          av.fallaron++
          break
        }
        enCurso.set(a, 0)
        await espera(2000 * intento ** 2)
      }
    }
    enCurso.delete(a)
    terminado += a.size
    av.listos++
    avisar()
  }
  // Con una semana, la primera va sola: crea el álbum de la actividad que usarán las demás.
  if (semana && porEnviar.length) await una(porEnviar[0])
  await enParalelo(semana ? porEnviar.slice(1) : porEnviar, EN_PARALELO, una)
  return salida
}

// --- Geometría (la de servicios/fototeca.py) ------------------------------------------------

export function escalaEnderezar(ancho: number, alto: number, grados: number): number {
  if (!grados || ancho <= 0 || alto <= 0) return 1
  const a = (Math.abs(grados) * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return Math.min(ancho / (ancho * c + alto * s), alto / (ancho * s + alto * c))
}

/**
 * Dibuja en un lienzo la foto con girar, voltear y enderezar (sin el recorte: el
 * editor lo muestra encima). El lienzo queda con el tamaño del encuadre.
 */
export function dibujarEncuadre(lienzo: HTMLCanvasElement, img: HTMLImageElement, a: Ajustes) {
  const rotar = a.rotar ?? 0
  const giradaW = rotar === 90 || rotar === 270 ? img.naturalHeight : img.naturalWidth
  const giradaH = rotar === 90 || rotar === 270 ? img.naturalWidth : img.naturalHeight
  const e = escalaEnderezar(giradaW, giradaH, a.enderezar ?? 0)
  const w = Math.max(1, Math.floor(giradaW * e))
  const h = Math.max(1, Math.floor(giradaH * e))
  lienzo.width = w
  lienzo.height = h
  const ctx = lienzo.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.translate(w / 2, h / 2)
  // Enderezar (horario), luego voltear y girar: en el lienzo las transformaciones
  // se componen al revés de como se aplican a la imagen.
  if (a.enderezar) ctx.rotate((a.enderezar * Math.PI) / 180)
  ctx.scale(a.voltear ? -1 : 1, a.voltear_v ? -1 : 1)
  ctx.rotate((rotar * Math.PI) / 180)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  ctx.restore()
}

/** El filtro CSS equivalente a brillo / contraste / saturación (vista previa en vivo). */
export function filtroCss(a: Ajustes): string {
  return `brightness(${a.brillo ?? 1}) contrast(${a.contraste ?? 1}) saturate(${a.saturacion ?? 1})`
}

/** El mayor recorte centrado de proporción `prop` (en píxeles del encuadre w×h), en relativo. */
export function recorteCentrado(w: number, h: number, prop: number): [number, number, number, number] {
  if (w / h > prop) {
    const rw = (h * prop) / w
    return [(1 - rw) / 2, 0, rw, 1]
  }
  const rh = w / prop / h
  return [0, (1 - rh) / 2, 1, rh]
}

// --- Fechas ---------------------------------------------------------------------------------

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «2026-09» → «septiembre de 2026». */
export const nombreMes = (m: string) => {
  const [a, n] = m.split('-')
  return `${MESES[Number(n) - 1] ?? n} de ${a}`
}

/** La fecha local (AAAA-MM-DD) de `tomada_en` (que ya llega con la zona de la entidad). */
export const diaDe = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
/** «2026-09-14» → «lunes 14 de septiembre de 2026». */
export function nombreDia(d: string): string {
  if (!d) return 'Sin fecha'
  const [a, m, n] = d.split('-').map(Number)
  const dia = new Date(a, m - 1, n)
  return `${DIAS[dia.getDay()]} ${n} de ${MESES[m - 1]} de ${a}`
}

export const pesoLegible = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
