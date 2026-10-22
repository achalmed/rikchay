/**
 * Cuadrícula JUSTIFICADA de la Fototeca (como la de un álbum de fotos): cada fila
 * llena el ancho con las fotos en su proporción real, agrupadas por el día en que
 * se tomaron. Las miniaturas se piden recién cuando entran en pantalla y, al
 * acercarse al final, se pide la página siguiente (desplazamiento infinito).
 *
 * Selección: casilla de cada foto; Mayús + clic marca el tramo; con algo
 * marcado, un clic en la foto también marca (no abre). La usa la página y el
 * selector de los otros módulos.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import StarIcon from '@mui/icons-material/Star'
import TuneIcon from '@mui/icons-material/Tune'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import { PALETA } from '@qillqa/tiqsi'
import { SELECCIONES, type Foto, diaDe, duracionLegible, esVideo, hexColor, nombreDia, nombreMes, traerImagen, urlMiniatura } from './modelo'
import { IconoSeleccion } from './Depuracion'

const ESPACIO = 4

/** Una miniatura protegida (con token), pedida al entrar en pantalla. */
export function Miniatura({ foto, ajuste }: { foto: Pick<Foto, 'id' | 'version' | 'nombre_original'> & Partial<Pick<Foto, 'ambito'>>; ajuste?: 'cover' | 'contain' }) {
  const caja = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState('')
  // Un activo de marca sin vista (un .ai de Illustrator) se muestra como documento, con su extensión.
  const [sinVista, setSinVista] = useState(false)
  // La marca se ve entera (un logotipo no se recorta).
  const encaje = ajuste ?? (foto.ambito === 'marca' || foto.ambito === 'prensa' ? 'contain' : 'cover')
  const [visible, setVisible] = useState(false)
  const ruta = urlMiniatura(foto)
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let vivo = true
    traerImagen(ruta).then((u) => vivo && setUrl(u)).catch(() => vivo && setSinVista(true))
    return () => {
      vivo = false
    }
  }, [visible, ruta])
  return (
    <Box ref={caja} sx={{ width: '100%', height: '100%', bgcolor: PALETA.superficieMedia }}>
      {url && (
        <img src={url} alt={foto.nombre_original} draggable={false} loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: encaje, display: 'block' }} />
      )}
      {sinVista && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5, p: 1, textAlign: 'center' }}>
          <Box sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary' }}>
            {(foto.nombre_original.split('.').pop() ?? '').toUpperCase()}
          </Box>
          <Box sx={{ fontSize: 11, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap' }}>{foto.nombre_original}</Box>
        </Box>
      )}
    </Box>
  )
}

/** Una fila justificada: sus fotos con el ancho que les toca y el alto común. */
export interface FilaJustificada<T> {
  fotos: { foto: T; indice: number; ancho: number }[]
  alto: number
}

/** Reparte las fotos en filas que llenan `ancho`; la última fila no se estira.
 *  Genérica: la usan la Fototeca y las fotos de la semana (semana/Fotos.tsx). */
export function filasJustificadas<T extends { proporcion: number }>(
  fotos: { foto: T; indice: number }[], ancho: number, altoObjetivo: number, espacio = ESPACIO,
): FilaJustificada<T>[] {
  const salida: FilaJustificada<T>[] = []
  let actual: { foto: T; indice: number }[] = []
  let suma = 0
  const cerrar = (estirar: boolean) => {
    const libre = ancho - espacio * (actual.length - 1)
    const alto = estirar ? libre / suma : Math.min(altoObjetivo, libre / suma)
    salida.push({ alto, fotos: actual.map((x) => ({ ...x, ancho: Math.max(40, Math.min(4, Math.max(0.25, x.foto.proporcion || 1.5)) * alto) })) })
    actual = []
    suma = 0
  }
  for (const x of fotos) {
    actual.push(x)
    suma += Math.min(4, Math.max(0.25, x.foto.proporcion || 1.5))
    if (suma * altoObjetivo + espacio * (actual.length - 1) >= ancho) cerrar(true)
  }
  if (actual.length) cerrar(false)
  return salida
}

interface Props {
  fotos: Foto[]
  /** Alto de fila deseado (px). */
  alto: number
  seleccion: Set<number>
  /** Marca o desmarca; `tramo` = con Mayús (desde la última marcada). */
  alMarcar: (id: number, indice: number, tramo: boolean) => void
  alAbrir: (indice: number) => void
  hayMas: boolean
  cargando: boolean
  alPedirMas: () => void
  /** En el selector: un clic marca siempre (no abre el visor). */
  soloMarcar?: boolean
  /** Sin cabeceras por día (el selector). */
  sinDias?: boolean
  /** Cómo agrupar (2026-10-10, como digiKam): por día, mes, álbum, actividad (vínculo) o etiqueta. */
  agrupar?: Agrupar
  /** Nombres de los álbumes (para agrupar por álbum). */
  albumes?: Map<number, string>
  /** Ids que ya están en este equipo (copia local): se marcan con un punto verde. */
  locales?: Set<number> | null
}

export type Agrupar = 'dia' | 'mes' | 'album' | 'actividad' | 'etiqueta' | 'ninguno'
export const AGRUPACIONES: { valor: Agrupar; etiqueta: string }[] = [
  { valor: 'dia', etiqueta: 'Por día' },
  { valor: 'mes', etiqueta: 'Por mes' },
  { valor: 'album', etiqueta: 'Por actividad (álbum)' },
  { valor: 'actividad', etiqueta: 'Por semana de representación' },
  { valor: 'etiqueta', etiqueta: 'Por etiqueta' },
  { valor: 'ninguno', etiqueta: 'Sin agrupar' },
]

function claveGrupo(f: Foto, agrupar: Agrupar, albumes?: Map<number, string>): string {
  switch (agrupar) {
    case 'mes': return diaDe(f.tomada_en).slice(0, 7)
    case 'album': return f.album_id ? albumes?.get(f.album_id) ?? `Actividad ${f.album_id}` : 'Sin actividad'
    case 'actividad': {
      const v = f.vinculos.find((x) => x.tipo === 'semana') ?? f.vinculos[0]
      return v ? v.etiqueta || `${v.tipo} ${v.id}` : 'Sin semana'
    }
    case 'etiqueta': return f.etiquetas[0] ?? 'Sin etiqueta'
    case 'ninguno': return ''
    default: return diaDe(f.tomada_en)
  }
}

function tituloGrupo(clave: string, agrupar: Agrupar): string {
  if (agrupar === 'dia') return nombreDia(clave)
  if (agrupar === 'mes') return nombreMes(clave)
  return clave
}

export default function Cuadricula({ fotos, alto, seleccion, alMarcar, alAbrir, hayMas, cargando, alPedirMas, soloMarcar, sinDias, agrupar = 'dia', albumes, locales }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const final = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(0)
  // El ancho disponible manda en las filas: se vuelve a medir al cambiar la ventana.
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setAncho(Math.floor(e.contentRect.width)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  // Desplazamiento infinito: el centinela del final pide la página siguiente.
  const pedir = useRef(alPedirMas)
  pedir.current = alPedirMas
  useEffect(() => {
    const el = final.current
    if (!el || !hayMas) return
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && pedir.current(), { rootMargin: '800px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hayMas, fotos.length])

  const modo: Agrupar = sinDias ? 'ninguno' : agrupar
  const grupos = useMemo(() => {
    const g: { dia: string; fotos: { foto: Foto; indice: number }[] }[] = []
    // Por día o mes las fotos ya vienen ordenadas por fecha (grupos contiguos); por álbum,
    // actividad o etiqueta se juntan aunque estén separadas.
    const contiguo = modo === 'dia' || modo === 'mes' || modo === 'ninguno'
    fotos.forEach((foto, indice) => {
      const dia = claveGrupo(foto, modo, albumes)
      const existente = contiguo ? (g[g.length - 1]?.dia === dia ? g[g.length - 1] : undefined) : g.find((x) => x.dia === dia)
      if (existente) existente.fotos.push({ foto, indice })
      else g.push({ dia, fotos: [{ foto, indice }] })
    })
    return g
  }, [fotos, modo, albumes])
  const enCelular = ancho > 0 && ancho < 600
  const altoFila = enCelular ? Math.min(alto, 130) : alto
  const conSeleccion = seleccion.size > 0

  return (
    <Box ref={caja} sx={{ width: '100%', userSelect: 'none' }}>
      {ancho > 0 && grupos.map((g) => {
        const todas = g.fotos.every((x) => seleccion.has(x.foto.id))
        return (
          <Box key={`${g.dia}-${g.fotos[0].indice}`} sx={{ mb: 2 }}>
            {modo !== 'ninguno' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.default' }}>
                <Box component="button" type="button" aria-label={todas ? 'Desmarcar el día' : 'Marcar todo el día'}
                  onClick={() => g.fotos.forEach((x) => (todas || !seleccion.has(x.foto.id)) && alMarcar(x.foto.id, x.indice, false))}
                  sx={{ border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', color: todas ? 'primary.main' : 'text.disabled', display: 'flex' }}>
                  {todas ? <CheckCircleIcon fontSize="small" /> : <RadioButtonUncheckedIcon fontSize="small" />}
                </Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, '&::first-letter': { textTransform: 'uppercase' } }}>{tituloGrupo(g.dia, modo)}</Typography>
                <Typography variant="caption" color="text.secondary">{g.fotos.length}</Typography>
              </Box>
            )}
            {filasJustificadas(g.fotos, ancho, altoFila).map((f, i) => (
              <Box key={i} sx={{ display: 'flex', gap: `${ESPACIO}px`, mb: `${ESPACIO}px` }}>
                {f.fotos.map(({ foto, indice, ancho: w }) => {
                  const marcada = seleccion.has(foto.id)
                  return (
                    <Box
                      key={foto.id}
                      role="button"
                      tabIndex={0}
                      aria-label={foto.titulo || foto.nombre_original}
                      onClick={(e) => (soloMarcar || conSeleccion || e.ctrlKey || e.metaKey ? alMarcar(foto.id, indice, e.shiftKey) : alAbrir(indice))}
                      onKeyDown={(e) => e.key === 'Enter' && alAbrir(indice)}
                      sx={{
                        position: 'relative', width: w, height: f.alto, flexShrink: 0, cursor: 'pointer', overflow: 'hidden', borderRadius: 0.5,
                        outline: marcada ? `3px solid ${PALETA.guinda}` : 'none', outlineOffset: -3,
                        '&:hover .fototeca-casilla, &:focus-visible .fototeca-casilla': { opacity: 1 },
                        '&:focus-visible': { outline: `3px solid ${PALETA.acento}` },
                      }}
                    >
                      {/* Una rechazada se ve apagada, como en digiKam: sigue ahí, pero no distrae. */}
                      <Box sx={{ width: '100%', height: '100%', transform: marcada ? 'scale(0.92)' : 'none', transition: 'transform .12s, opacity .12s', opacity: foto.seleccion === 'rechazada' ? 0.45 : 1 }}>
                        <Miniatura foto={foto} />
                      </Box>
                      <Box
                        className="fototeca-casilla"
                        component="span"
                        onClick={(e) => {
                          e.stopPropagation()
                          alMarcar(foto.id, indice, e.shiftKey)
                        }}
                        sx={{
                          position: 'absolute', top: 4, left: 4, display: 'flex', borderRadius: '50%',
                          // Sobre la foto (en ambos modos): el círculo lleno en tinta y la marca en `sobrePrimario`; un blanco fijo la borraría en la oscura (2026-10-19).
                          color: marcada ? PALETA.guinda : '#fff', bgcolor: marcada ? PALETA.sobrePrimario : 'rgba(0,0,0,.25)',
                          opacity: marcada || conSeleccion ? 1 : { xs: 0.85, md: 0 }, transition: 'opacity .12s',
                        }}
                      >
                        {marcada ? <CheckCircleIcon fontSize="small" /> : <RadioButtonUncheckedIcon fontSize="small" />}
                      </Box>
                      <Box sx={{ position: 'absolute', right: 4, bottom: 4, display: 'flex', alignItems: 'center', gap: 0.25, color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,.7))' }}>
                        {/* Por revisar: un punto arena entre los iconos, no una barra (rediseño 2026-10-19). */}
                        {foto.estado === 'por_revisar' && <Box title="Por revisar" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: PALETA.aviso, mr: 0.25 }} />}
                        {foto.color && <Box title={`Color: ${foto.color}`} sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: hexColor(foto.color), boxShadow: '0 0 0 1.5px rgba(255,255,255,.85)', mr: 0.25 }} />}
                        {foto.seleccion && <IconoSeleccion valor={foto.seleccion} sx={{ fontSize: 15 }} titleAccess={SELECCIONES.find((x) => x.valor === foto.seleccion)?.etiqueta} />}
                        {(foto.n_versiones ?? 0) > 0 && <LayersOutlinedIcon sx={{ fontSize: 15 }} titleAccess={foto.n_versiones === 1 ? 'Tiene una versión editada' : `Tiene ${foto.n_versiones} versiones editadas`} />}
                        {foto.version !== '0' && <TuneIcon sx={{ fontSize: 15 }} titleAccess="Editada" />}
                        {foto.favorita && <StarIcon sx={{ fontSize: 16 }} titleAccess="Favorita" />}
                      </Box>
                      {esVideo(foto) && (
                        <Box sx={{ position: 'absolute', left: 4, bottom: 4, display: 'flex', alignItems: 'center', gap: 0.25, px: 0.5, borderRadius: 0.5, color: '#fff', bgcolor: 'rgba(0,0,0,.55)', fontSize: 11.5, fontWeight: 600 }}>
                          <PlayCircleOutlineIcon sx={{ fontSize: 14 }} titleAccess="Video" />
                          {duracionLegible(foto.duracion)}
                        </Box>
                      )}
                      {/* Copia local (2026-10-10): punto verde = ya está en este equipo; hueco = solo en la Mediateca. */}
                      {locales && (
                        <Box
                          title={locales.has(foto.id) ? 'Guardada en este equipo' : 'Solo en la Mediateca (sin copia en este equipo)'}
                          sx={{ position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: '50%', boxShadow: '0 0 0 1.5px rgba(0,0,0,.35)',
                            bgcolor: locales.has(foto.id) ? PALETA.exito : 'rgba(255,255,255,.85)' }}
                        />
                      )}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        )
      })}
      <Box ref={final} sx={{ height: 1 }} />
      {cargando && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}
    </Box>
  )
}
