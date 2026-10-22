/**
 * VISOR de la Fototeca: la foto grande (con sus ajustes) y, al lado, su ficha
 * editable — título, pie, lugar, etiquetas, personas, estado, calificación,
 * álbum—, el EXIF (solo lectura) y dónde se usó (semanas, proyectos, documentos).
 * ←/→ pasan de foto, Esc cierra. En el celular la ficha va debajo de la foto.
 *
 * Los textos se guardan al salir del campo (PATCH de solo lo que cambió); las
 * elecciones (estado, estrellas, álbum, etiquetas), al elegirlas.
 *
 * «Usar en Prensa» (2026-10-06) deja la foto, con sus ajustes, en el banco del
 * editor de fotos (Tullpu, `POST /api/fotos/traer/{id}`; E5) y la abre en él, en Prensa.
 *
 * CARAS (2026-10-19, como en digiKam): el botón de la cara pasa la foto a su vista sin ajustes con quién aparece
 * marcado encima; arrastrar marca una cara nueva y tocar una la nombra o la quita. «Detectar caras» (si OpenCV
 * está instalado en el servidor) solo propone: cada propuesta entra cuando alguien le pone nombre (Caras.tsx).
 *
 * VERSIONES (2026-10-19): lo editado que salió de una foto (la que cita una semana) no está suelto en la
 * cuadrícula; se ve aquí, debajo de su original, y tocarlo lo muestra en el visor (Versiones.tsx).
 *
 * Un VIDEO (2026-10-06) se reproduce aquí con su póster: el <video> no puede mandar
 * el token, así que pide un enlace firmado de vida corta (`enlace-video`). No se edita
 * ni se exporta por tamaños: se descarga el original.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Dialog from '@mui/material/Dialog'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Autocomplete from '@mui/material/Autocomplete'
import Chip from '@mui/material/Chip'
import Rating from '@mui/material/Rating'
import Tooltip from '@mui/material/Tooltip'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined'
import LinkIcon from '@mui/icons-material/Link'
import NewspaperOutlinedIcon from '@mui/icons-material/NewspaperOutlined'
import { api, PALETA, rol } from '@qillqa/tiqsi'
import {
  ESTADOS, NOMBRE_VINCULO, PRESETS, RUTA_VINCULO, type Album, type Foto, type Lugar, bajar, exportar, nombreDia, pesoLegible,
  traerImagen, urlVista, diaDe, esVideo, duracionLegible, seleccionDeTecla,
} from './modelo'
import Depuracion from './Depuracion'
import Versiones, { type DatosVersiones } from './Versiones'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import CapaCaras, { ListaCaras, PreguntaCara, type Cara, type Elegida, type Propuesta } from './Caras'
import FaceOutlinedIcon from '@mui/icons-material/FaceOutlined'
import FaceRetouchingNaturalIcon from '@mui/icons-material/FaceRetouchingNatural'

interface Props {
  fotos: Foto[]
  indice: number | null
  alCambiarIndice: (i: number | null) => void
  albumes: Album[]
  /** Los lugares con nombre (mapa): el campo Lugar los propone. */
  lugares: Lugar[]
  etiquetas: string[]
  personas: string[]
  soloLectura: boolean
  /** La foto cambió en el servidor (la página la reemplaza en su lista). */
  alActualizar: (f: Foto) => void
  alEditar: (f: Foto) => void
  alPapelera: (f: Foto, papelera: boolean) => void
  avisar: (tipo: 'success' | 'error' | 'info', t: string) => void
}

/** El video, con su póster mientras carga (enlace firmado: el <video> no manda el token). */
function Reproductor({ foto }: { foto: Foto }) {
  const [poster, setPoster] = useState('')
  const [fuente, setFuente] = useState('')
  const [error, setError] = useState('')
  const ruta = urlVista(foto)
  useEffect(() => {
    let vivo = true
    setFuente('')
    setError('')
    traerImagen(ruta).then((u) => vivo && setPoster(u)).catch(() => {})
    api<{ url: string }>(`/api/fototeca/${foto.id}/enlace-video`)
      .then((r) => vivo && setFuente(r.url))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se pudo abrir el video.'))
    return () => {
      vivo = false
    }
  }, [foto.id, ruta])
  if (error) return <Typography sx={{ color: '#fff' }}>{error}</Typography>
  if (!fuente) return <CircularProgress sx={{ color: '#fff' }} />
  return (
    <video
      key={fuente}
      src={fuente}
      poster={poster || undefined}
      controls
      preload="metadata"
      aria-label={foto.titulo || foto.nombre_original}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: PALETA.oscuroVisor }}
    />
  )
}

/** La vista grande; mientras llega, la miniatura que ya está en memoria. */
function Grande({ foto }: { foto: Foto }) {
  const [url, setUrl] = useState('')
  const ruta = urlVista(foto)
  const video = esVideo(foto)
  useEffect(() => {
    if (video) return
    let vivo = true
    setUrl('')
    traerImagen(ruta).then((u) => vivo && setUrl(u)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [ruta, video])
  if (video) return <Reproductor foto={foto} />
  return url ? (
    <img src={url} alt={foto.titulo || foto.nombre_original} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
  ) : (
    <CircularProgress sx={{ color: '#fff' }} />
  )
}

/** De dónde salió la fecha cuando no es la del propio archivo (EXIF). */
function notaFecha(f: Foto, que: string): string {
  if (f.fecha_exif) return ''
  if (f.fecha_fuente === 'nombre') return ' (fecha tomada del nombre del archivo)'
  if (f.fecha_fuente === 'actividad') return ' (fecha de su actividad)'
  return ` (fecha de subida: ${que} no traía fecha)`
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{etiqueta}</Typography>
      {children}
    </Box>
  )
}

export default function Visor({ fotos, indice, alCambiarIndice, albumes, lugares, etiquetas, personas, soloLectura, alActualizar, alEditar, alPapelera, avisar }: Props) {
  const navegar = useNavigate()
  const tema = useTheme()
  const angosta = useMediaQuery(tema.breakpoints.down('md'))
  const resumen = indice !== null ? fotos[indice] : null
  const [detalle, setDetalle] = useState<Foto | null>(null)
  const [textos, setTextos] = useState({ titulo: '', descripcion: '', lugar: '' })
  const [menuExportar, setMenuExportar] = useState<HTMLElement | null>(null)
  const [exportando, setExportando] = useState(false)
  const [aPrensa, setAPrensa] = useState(false)
  // El atajo de teclado guarda con la función del render vigente (la foto abierta).
  const guardarRef = useRef<((c: Partial<Foto>) => Promise<void>) | null>(null)
  // Caras: el modo (la foto sin ajustes con sus regiones), las marcadas, lo que propone el detector y la elegida.
  const [modoCaras, setModoCaras] = useState(false)
  const [caras, setCaras] = useState<Cara[]>([])
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [elegida, setElegida] = useState<Elegida | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  // Versiones: el original y sus ediciones; `alterna` es la que se está mirando en vez de la de la lista.
  const [versiones, setVersiones] = useState<DatosVersiones | null>(null)
  const [alterna, setAlterna] = useState<Foto | null>(null)
  const [detector, setDetector] = useState<{ disponible: boolean; motivo?: string } | null>(null)
  const conPrensa = rol() !== 'invitado'

  // La ficha completa (EXIF, quién la subió) se pide al abrir cada foto.
  useEffect(() => {
    if (!resumen) {
      setDetalle(null)
      return
    }
    let vivo = true
    setDetalle(resumen)
    setTextos({ titulo: resumen.titulo, descripcion: resumen.descripcion, lugar: resumen.lugar })
    api<Foto>(`/api/fototeca/${resumen.id}`).then((d) => vivo && setDetalle(d)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [resumen?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAlterna(null)
    setVersiones(null)
    if (!resumen || resumen.medio === 'video' || resumen.medio === 'documento') return
    let vivo = true
    api<DatosVersiones>(`/api/fototeca/${resumen.id}/versiones`).then((d) => vivo && setVersiones(d)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [resumen?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Los campos de texto son de la foto que se mira: al pasar a otra versión, los suyos.
  useEffect(() => {
    const x = alterna ?? resumen
    if (x) setTextos({ titulo: x.titulo, descripcion: x.descripcion, lugar: x.lugar })
  }, [alterna]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPropuestas([])
    setElegida(null)
    setCaras([])
    if (!resumen || resumen.medio === 'video' || resumen.medio === 'documento') return
    let vivo = true
    api<{ caras: Cara[] }>(`/api/fototeca/${resumen.id}/caras`).then((r) => vivo && setCaras(r.caras)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [resumen?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (modoCaras && detector === null) api<{ disponible: boolean; motivo?: string }>('/api/fototeca/caras/detector').then(setDetector).catch(() => setDetector({ disponible: false }))
  }, [modoCaras, detector])

  // ←/→ entre fotos (salvo escribiendo en un campo).
  useEffect(() => {
    if (indice === null) return
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"], video')) return
      if (e.key === 'ArrowRight' && indice < fotos.length - 1) alCambiarIndice(indice + 1)
      if (e.key === 'ArrowLeft' && indice > 0) alCambiarIndice(indice - 1)
      // Alt+0…3: la depuración de digiKam sin soltar el teclado.
      const sel = soloLectura ? null : seleccionDeTecla(e)
      if (sel !== null && fotos[indice]) {
        e.preventDefault()
        void guardarRef.current?.({ seleccion: sel })
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [indice, fotos, alCambiarIndice, soloLectura])

  if (indice === null || !resumen) return null
  // La lista manda en lo que cambia (ajustes guardados en el editor); el detalle aporta el EXIF.
  const deLista: Foto = detalle && detalle.id === resumen.id ? { ...detalle, ...resumen } : resumen
  // Mirando otra versión (o el original de una versión): esa foto, con sus datos.
  const f: Foto = alterna && alterna.id !== resumen.id ? alterna : deLista
  const enAlterna = f.id !== resumen.id

  async function guardar(cambio: Partial<Foto>) {
    try {
      const nueva = await api<Foto>(`/api/fototeca/${f.id}`, { method: 'PATCH', body: JSON.stringify(cambio) })
      setDetalle((antes) => ({ ...(antes ?? {}), ...nueva }))
      alActualizar(nueva)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo guardar.')
    }
  }
  guardarRef.current = guardar

  /** Una llamada de caras: la respuesta trae las caras y la lista `personas` de la foto, que pasa a la página. */
  async function conCaras(ruta: string, metodo: string, cuerpo?: unknown) {
    setOcupado(true)
    try {
      const r = await api<{ caras: Cara[]; personas: string[] }>(ruta, { method: metodo, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
      setCaras(r.caras)
      setDetalle((antes) => (antes ? { ...antes, personas: r.personas } : antes))
      alActualizar({ ...f, personas: r.personas })
      setElegida(null)
      return true
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo guardar la cara.')
      return false
    } finally {
      setOcupado(false)
    }
  }
  async function guardarCara(nombre: string) {
    if (!elegida) return
    if (elegida.tipo === 'cara') return void conCaras(`/api/fototeca/caras/${elegida.cara.id}`, 'PATCH', { persona: nombre })
    const { x, y, ancho, alto } = elegida.caja
    const propuesta = elegida.tipo === 'propuesta' ? elegida : null
    const ok = await conCaras(`/api/fototeca/${f.id}/caras`, 'POST', {
      x, y, ancho, alto, persona: nombre, origen: propuesta ? 'modelo' : 'manual', confianza: propuesta?.caja.confianza ?? null,
    })
    if (ok && propuesta) setPropuestas((antes) => antes.filter((_, i) => i !== propuesta.indice))
  }
  function quitarCara() {
    if (!elegida) return
    if (elegida.tipo === 'cara') return void conCaras(`/api/fototeca/caras/${elegida.cara.id}`, 'DELETE')
    if (elegida.tipo === 'propuesta') {
      const i = elegida.indice
      setPropuestas((antes) => antes.filter((_, k) => k !== i))
    }
    setElegida(null)
  }
  async function detectar() {
    setOcupado(true)
    try {
      const r = await api<{ propuestas: Propuesta[] }>(`/api/fototeca/${f.id}/detectar-caras`, { method: 'POST' })
      setPropuestas(r.propuestas)
      // Lo propuesto se ve en la foto (línea punteada) y en la ficha; solo se avisa si no hubo nada.
      if (!r.propuestas.length) avisar('info', 'No se encontraron caras nuevas.')
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo detectar.')
    } finally {
      setOcupado(false)
    }
  }
  const guardarTexto = (clave: 'titulo' | 'descripcion' | 'lugar') => {
    const texto = textos[clave].trim()
    if (texto === (f[clave] ?? '')) return
    // Un lugar con nombre escrito tal cual (o elegido de la lista) se guarda como ese lugar del mapa.
    const conNombre = clave === 'lugar' ? lugares.find((l) => l.nombre.toLowerCase() === texto.toLowerCase()) : undefined
    void guardar(conNombre ? { lugar_id: conNombre.id } : { [clave]: texto })
  }
  async function descargar(preset: string) {
    setMenuExportar(null)
    setExportando(true)
    try {
      // Un video va tal cual (su original): el servidor ignora el tamaño.
      const { blob, nombre } = await exportar([f.id], preset)
      bajar(blob, nombre)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo exportar.')
    } finally {
      setExportando(false)
    }
  }

  async function usarEnPrensa() {
    setAPrensa(true)
    try {
      const r = await api<{ url: string }>(`/api/fotos/traer/${f.id}`, { method: 'POST' })
      navegar(`/prensa?vista=foto&imagen=${encodeURIComponent(r.url)}`)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo llevar la foto a Prensa.')
    } finally {
      setAPrensa(false)
    }
  }

  const exif = f.exif ?? {}
  const video = esVideo(f)
  const datosExif = video ? [
    ['Grabado', f.tomada_en ? `${nombreDia(diaDe(f.tomada_en))}, ${f.tomada_en.slice(11, 16)}${notaFecha(f, 'el video')}` : ''],
    ['Duración', duracionLegible(f.duracion)],
    ['Cámara', f.camara],
    ['Formato', [exif.codec, exif.cuadros, exif.audio && `audio: ${exif.audio}`].filter(Boolean).join(' · ')],
    ['Tamaño', `${f.ancho} × ${f.alto} px · ${pesoLegible(f.bytes)}`],
    ['Archivo', f.nombre_original],
    ['Subido por', f.subido_por_nombre],
  ].filter(([, v]) => v) as [string, string][] : [
    ['Tomada', f.tomada_en ? `${nombreDia(diaDe(f.tomada_en))}, ${f.tomada_en.slice(11, 16)}${notaFecha(f, 'la foto')}` : ''],
    ['Cámara', f.camara],
    ['Objetivo', exif.objetivo],
    ['Exposición', [exif.exposicion, exif.apertura, exif.iso && `ISO ${exif.iso}`, exif.focal].filter(Boolean).join(' · ')],
    ['Tamaño', `${f.ancho} × ${f.alto} px · ${pesoLegible(f.bytes)}`],
    ['Archivo', f.nombre_original],
    ['Subida por', f.subido_por_nombre],
  ].filter(([, v]) => v) as [string, string][]

  return (
    <Dialog open fullScreen onClose={() => alCambiarIndice(null)} PaperProps={{ sx: { bgcolor: PALETA.oscuroVisor } }}>
      <Box ref={contenedor} sx={{ display: 'flex', flexDirection: angosta ? 'column' : 'row', height: '100%', overflow: angosta ? 'auto' : 'hidden' }}>
        {/* La foto. */}
        <Box sx={{ position: 'relative', flex: angosta ? '0 0 auto' : 1, height: angosta ? '62dvh' : '100%', display: 'grid', placeItems: 'center', p: { xs: 1, md: 3 }, minWidth: 0 }}>
          {/* Caja absoluta: el alto en % de una imagen dentro de una rejilla no se resuelve. */}
          <Box sx={{ position: 'absolute', inset: { xs: '52px 8px 8px', md: '56px 24px 24px' }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {modoCaras && !video && !enAlterna ? (
              <CapaCaras foto={f} caras={caras} propuestas={propuestas} elegida={elegida} alElegir={setElegida} soloLectura={soloLectura || !!f.eliminada_en} />
            ) : (
              <Grande foto={f} />
            )}
          </Box>
          {enAlterna && (
            <Box sx={{ position: 'absolute', left: '50%', bottom: { xs: 12, md: 28 }, transform: 'translateX(-50%)', zIndex: 2, display: 'flex', alignItems: 'center', gap: 1,
              px: 1.5, py: 0.5, borderRadius: 4, bgcolor: 'rgba(0,0,0,.62)', color: '#fff', whiteSpace: 'nowrap' }}>
              <LayersOutlinedIcon sx={{ fontSize: 18 }} />
              <Typography variant="body2">{f.version_de ? 'Versión editada' : 'Original'}</Typography>
              <Button size="small" sx={{ color: '#fff', textDecoration: 'underline' }} onClick={() => setAlterna(null)}>Volver</Button>
            </Box>
          )}
          {modoCaras && elegida && !enAlterna && (
            <PreguntaCara elegida={elegida} personas={personas} ocupado={ocupado} alGuardar={(n) => void guardarCara(n)} alQuitar={quitarCara} alCerrar={() => setElegida(null)} />
          )}
          <Box sx={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.5, color: '#fff' }}>
            <Tooltip title="Cerrar (Esc)">
              <IconButton onClick={() => alCambiarIndice(null)} sx={{ color: '#fff' }} aria-label="Cerrar"><CloseIcon /></IconButton>
            </Tooltip>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>{indice + 1} de {fotos.length}</Typography>
            <Box sx={{ flex: 1 }} />
            {!soloLectura && !f.eliminada_en && (
              <Tooltip title={f.favorita ? 'Quitar de favoritas' : 'Marcar como favorita'}>
                <IconButton sx={{ color: '#fff' }} onClick={() => void guardar({ favorita: !f.favorita })}>
                  {f.favorita ? <StarIcon /> : <StarBorderIcon />}
                </IconButton>
              </Tooltip>
            )}
            {!video && f.medio !== 'documento' && !enAlterna && (
              <Tooltip title={modoCaras ? 'Volver a la foto' : 'Caras: quién aparece y dónde'}>
                <IconButton sx={{ color: '#fff', bgcolor: modoCaras ? 'rgba(255,255,255,.18)' : undefined }} aria-pressed={modoCaras}
                  onClick={() => { setModoCaras(!modoCaras); setElegida(null) }} aria-label="Caras">
                  <FaceOutlinedIcon />
                </IconButton>
              </Tooltip>
            )}
            {/* Una versión es un archivo ya exportado: se cambia editando su original. */}
            {!soloLectura && !f.eliminada_en && !video && !f.version_de && (
              <Tooltip title="Editar: girar, recortar, enderezar, luz y color (el original no se toca)">
                <IconButton sx={{ color: '#fff' }} onClick={() => alEditar(f)}><EditOutlinedIcon /></IconButton>
              </Tooltip>
            )}
            <Tooltip title={video ? 'Descargar el video original' : 'Descargar con sus ajustes'}>
              <span>
                <IconButton sx={{ color: '#fff' }} disabled={exportando} aria-label={video ? 'Descargar el video' : 'Descargar'}
                  onClick={(e) => (video ? void descargar('original') : setMenuExportar(e.currentTarget))}>
                  {exportando ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : <FileDownloadOutlinedIcon />}
                </IconButton>
              </span>
            </Tooltip>
            {conPrensa && !f.eliminada_en && !video && (
              <Tooltip title="Usar en Prensa: abrirla en el editor de fotos y videos (con sus ajustes)">
                <span>
                  <IconButton sx={{ color: '#fff' }} disabled={aPrensa} onClick={() => void usarEnPrensa()} aria-label="Usar en Prensa">
                    {aPrensa ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : <NewspaperOutlinedIcon />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {!soloLectura && (
              <Tooltip title={f.eliminada_en ? 'Restaurar de la papelera' : 'Mandar a la papelera'}>
                <IconButton sx={{ color: '#fff' }} onClick={() => alPapelera(f, !f.eliminada_en)}>
                  {f.eliminada_en ? <RestoreFromTrashOutlinedIcon /> : <DeleteOutlineIcon />}
                </IconButton>
              </Tooltip>
            )}
          </Box>
          {indice > 0 && (
            <IconButton aria-label="Anterior" onClick={() => alCambiarIndice(indice - 1)}
              sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,.35)', '&:hover': { bgcolor: 'rgba(0,0,0,.55)' } }}>
              <ChevronLeftIcon fontSize="large" />
            </IconButton>
          )}
          {indice < fotos.length - 1 && (
            <IconButton aria-label="Siguiente" onClick={() => alCambiarIndice(indice + 1)}
              sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,.35)', '&:hover': { bgcolor: 'rgba(0,0,0,.55)' } }}>
              <ChevronRightIcon fontSize="large" />
            </IconButton>
          )}
        </Box>

        {/* La ficha. */}
        <Box sx={{ width: angosta ? '100%' : 360, flexShrink: 0, bgcolor: 'background.paper', p: 2, overflowY: angosta ? 'visible' : 'auto' }}>
          <Campo etiqueta="Título">
            <TextField size="small" fullWidth value={textos.titulo} disabled={soloLectura} placeholder="Qué es (para buscarla)"
              onChange={(e) => setTextos({ ...textos, titulo: e.target.value })} onBlur={() => guardarTexto('titulo')} />
          </Campo>
          <Campo etiqueta={video ? 'Descripción' : 'Pie de foto'}>
            <TextField size="small" fullWidth multiline minRows={2} value={textos.descripcion} disabled={soloLectura}
              placeholder="Actividad y lugar, en una línea; sin nombrar a personas"
              onChange={(e) => setTextos({ ...textos, descripcion: e.target.value })} onBlur={() => guardarTexto('descripcion')} />
          </Campo>
          <Campo etiqueta="Lugar">
            <Autocomplete freeSolo size="small" options={lugares.map((l) => l.nombre)} inputValue={textos.lugar} disabled={soloLectura}
              onInputChange={(_, v, motivo) => motivo !== 'reset' && setTextos((t) => ({ ...t, lugar: v }))}
              onChange={(_, v) => {
                const l = lugares.find((x) => x.nombre === v)
                if (l) {
                  setTextos((t) => ({ ...t, lugar: l.nombre }))
                  if (f.lugar_id !== l.id) void guardar({ lugar_id: l.id })
                }
              }}
              renderInput={(p) => <TextField {...p} placeholder="Distrito, provincia o local" onBlur={() => guardarTexto('lugar')}
                helperText={f.lugar_id ? 'Lugar con nombre (del mapa)' : undefined} />} />
            {f.lat !== null && f.lon !== null && (
              <Typography variant="caption" color="text.secondary">
                GPS de la cámara: {f.lat.toFixed(5)}, {f.lon.toFixed(5)} ·{' '}
                <a href={`https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lon}#map=16/${f.lat}/${f.lon}`} target="_blank" rel="noopener noreferrer">ver en el mapa</a>
              </Typography>
            )}
          </Campo>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-end' }}>
            <TextField select size="small" label="Estado" value={f.estado} disabled={soloLectura} sx={{ flex: 1 }}
              onChange={(e) => void guardar({ estado: e.target.value as Foto['estado'] })}
              helperText="Solo las públicas van a publicaciones e informes">
              {ESTADOS.map((e) => (
                <MenuItem key={e.valor} value={e.valor}>
                  <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: e.color, display: 'inline-block', mr: 1 }} />
                  {e.etiqueta}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ pb: 3 }}>
              <Rating value={f.calificacion} readOnly={soloLectura} onChange={(_, v) => void guardar({ calificacion: v ?? 0 })} />
            </Box>
          </Box>
          <Campo etiqueta="Selección">
            <Depuracion seleccion={f.seleccion} color={f.color} deshabilitado={soloLectura || !!f.eliminada_en} alCambiar={(c) => void guardar(c)} />
          </Campo>
          <Campo etiqueta="Álbum">
            <TextField select size="small" fullWidth value={f.album_id ?? ''} disabled={soloLectura} SelectProps={{ displayEmpty: true }}
              onChange={(e) => void guardar({ album_id: e.target.value === '' ? null : Number(e.target.value) })}>
              <MenuItem value="">Sin álbum</MenuItem>
              {albumes.map((a) => <MenuItem key={a.id} value={a.id}>{a.nombre}</MenuItem>)}
            </TextField>
          </Campo>
          <Campo etiqueta="Etiquetas">
            <Autocomplete multiple freeSolo size="small" options={etiquetas} value={f.etiquetas} disabled={soloLectura}
              onChange={(_, v) => void guardar({ etiquetas: v as string[] })}
              renderTags={(v, props) => v.map((o, i) => <Chip size="small" label={o} {...props({ index: i })} key={o} />)}
              renderInput={(p) => <TextField {...p} placeholder="Tema, evento, institución… (Enter)" />} />
          </Campo>
          <Campo etiqueta="Personas">
            <Autocomplete multiple freeSolo size="small" options={personas} value={f.personas} disabled={soloLectura}
              onChange={(_, v) => void guardar({ personas: v as string[] })}
              renderTags={(v, props) => v.map((o, i) => <Chip size="small" variant="outlined" label={o} {...props({ index: i })} key={o} />)}
              renderInput={(p) => <TextField {...p} placeholder="Quién aparece (Enter)" />} />
            {!video && (
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <ListaCaras caras={caras} propuestas={propuestas} alElegir={(e) => { setModoCaras(true); setElegida(e); contenedor.current?.scrollTo({ top: 0, behavior: 'smooth' }) }} />
                {!soloLectura && !f.eliminada_en && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {!modoCaras ? (
                      <Button size="small" variant="outlined" startIcon={<FaceOutlinedIcon />} onClick={() => setModoCaras(true)}>Marcar caras</Button>
                    ) : (
                      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Arrastre sobre la foto para marcar una cara.</Typography>
                    )}
                    {modoCaras && detector?.disponible && (
                      <Button size="small" variant="outlined" startIcon={ocupado ? <CircularProgress size={14} /> : <FaceRetouchingNaturalIcon />} disabled={ocupado} onClick={() => void detectar()}>
                        Detectar caras
                      </Button>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Campo>
          {f.vinculos.length > 0 && (
            <Campo etiqueta="Se usa en">
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {f.vinculos.map((v) => (
                  <Chip key={`${v.tipo}-${v.id}`} size="small" icon={<LinkIcon />} clickable
                    label={`${v.etiqueta ?? NOMBRE_VINCULO[v.tipo]}${v.codigo ? ` · ${v.codigo}` : ''}${v.seleccion ? ' · en el informe' : ''}`}
                    title={NOMBRE_VINCULO[v.tipo]}
                    onClick={() => navegar(RUTA_VINCULO[v.tipo](v.id))} />
                ))}
              </Box>
            </Campo>
          )}
          {versiones && versiones.versiones.length > 0 && (
            <Campo etiqueta={versiones.es_version ? 'Original y versiones' : 'Versiones'}>
              <Versiones datos={versiones} actual={f.id} alElegir={(v) => { setModoCaras(false); setAlterna(v.id === resumen.id ? null : v); contenedor.current?.scrollTo({ top: 0, behavior: 'smooth' }) }} />
            </Campo>
          )}
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{video ? 'Datos del video' : 'Datos de la cámara'}</Typography>
          {datosExif.map(([k, v]) => (
            <Box key={k} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 84, flexShrink: 0 }}>{k}</Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-word', '&::first-letter': { textTransform: 'uppercase' } }}>{v}</Typography>
            </Box>
          ))}
          {f.version !== '0' && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: PALETA.textoTenue }}>
              Editada: se muestra con sus ajustes; el original sigue intacto.
            </Typography>
          )}
          {f.eliminada_en && (
            <Button sx={{ mt: 2 }} variant="outlined" startIcon={<RestoreFromTrashOutlinedIcon />} disabled={soloLectura} onClick={() => alPapelera(f, false)}>
              Restaurar de la papelera
            </Button>
          )}
        </Box>
      </Box>
      <Menu anchorEl={menuExportar} open={Boolean(menuExportar)} onClose={() => setMenuExportar(null)}>
        {PRESETS.map((p) => <MenuItem key={p.clave} onClick={() => void descargar(p.clave)}>{p.etiqueta}</MenuItem>)}
      </Menu>
    </Dialog>
  )
}
