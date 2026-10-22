/**
 * MAPA de la Mediateca (2026-10-19; backend/app/servicios/lugares.py): dónde se tomó cada foto de la vista (las
 * coordenadas del GPS de la cámara, con los mismos filtros de la cuadrícula) y los LUGARES con nombre.
 *
 *   - Las fotos cercanas se juntan en una miniatura con su cuenta; tocarla acerca el mapa y, de cerca (o si es
 *     una sola), abre el visor con esas fotos.
 *   - Los lugares con nombre son círculos (centro y radio). «Nuevo lugar» pone una cruz en el centro: se mueve el
 *     mapa debajo y «Poner aquí» lo crea; desde
 *     la lista se ven sus fotos, se le asignan las cercanas (primero dice cuántas), se renombra o se quita.
 *
 * Leaflet se carga solo aquí (la página lo importa con `lazy`). Las teselas son las de OpenStreetMap salvo que
 * `VITE_MAPA_TESELAS` diga otras: el navegador las pide para el área que se ve, nunca las coordenadas de las fotos.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { api, confirmar, PALETA } from '@qillqa/tiqsi'
import { type Foto, type Lugar, type Pagina, traerImagen, urlMiniatura } from './modelo'

const TESELAS = (import.meta.env.VITE_MAPA_TESELAS as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATRIBUCION = (import.meta.env.VITE_MAPA_ATRIBUCION as string | undefined) || '© colaboradores de OpenStreetMap'
/** Lado (px) de la celda que junta fotos cercanas, y desde qué acercamiento un grupo se abre en el visor. */
const CELDA = 64
const CERCA = 16

type Punto = [number, number, number, string] // id, lat, lon, versión de la miniatura

interface Props {
  consulta: string
  lugares: Lugar[]
  soloLectura: boolean
  alAbrir: (fotos: Foto[]) => void
  alCambiarLugares: () => void
  alVerLugar: (nombre: string) => void
  avisar: (tipo: 'success' | 'error' | 'info', t: string) => void
}

/** Junta los puntos que caen en la misma celda de la pantalla con el acercamiento actual. */
function agrupar(mapa: L.Map, puntos: Punto[]): Punto[][] {
  const celdas = new Map<string, Punto[]>()
  for (const p of puntos) {
    const xy = mapa.project([p[1], p[2]], mapa.getZoom())
    const clave = `${Math.floor(xy.x / CELDA)}:${Math.floor(xy.y / CELDA)}`
    celdas.set(clave, [...(celdas.get(clave) ?? []), p])
  }
  return [...celdas.values()]
}

function icono(grupo: Punto[]): L.DivIcon {
  const n = grupo.length
  return L.divIcon({
    className: 'mediateca-pin',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<div style="width:48px;height:48px;border-radius:10px;overflow:hidden;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);background:#888;position:relative">`
      + `<img data-foto="${grupo[0][0]}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
      + (n > 1 ? `<span style="position:absolute;right:2px;bottom:2px;min-width:18px;padding:0 4px;border-radius:9px;background:rgba(0,0,0,.7);color:#fff;font:600 11px/18px system-ui;text-align:center">${n}</span>` : '')
      + '</div>',
  })
}

function DialogoLugar({ lugar, alCerrar, alGuardar }: { lugar: Partial<Lugar> | null; alCerrar: () => void; alGuardar: (l: Partial<Lugar>) => void }) {
  const [d, setD] = useState<Partial<Lugar>>({})
  const nombre = useRef<HTMLInputElement>(null)
  useEffect(() => setD(lugar ?? {}), [lugar])
  return (
    // El diálogo vive montado: el foco se pone al abrir (autoFocus solo vale al montar).
    <Dialog open={lugar !== null} onClose={alCerrar} fullWidth maxWidth="xs" TransitionProps={{ onEntered: () => nombre.current?.focus() }}>
      <DialogTitle>{lugar?.id ? 'Lugar' : 'Nuevo lugar'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField label="Nombre" inputRef={nombre} value={d.nombre ?? ''} onChange={(e) => setD({ ...d, nombre: e.target.value })} placeholder="Plaza de Armas de Huamanga" />
        <TextField label="Radio (metros)" type="number" value={d.radio_m ?? 200} onChange={(e) => setD({ ...d, radio_m: Number(e.target.value) })}
          helperText="Las fotos tomadas dentro del radio pueden entrar en este lugar" inputProps={{ min: 10, max: 50000, step: 50 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" disabled={!d.nombre?.trim()} onClick={() => alGuardar(d)}>Guardar</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Mapa({ consulta, lugares, soloLectura, alAbrir, alCambiarLugares, alVerLugar, avisar }: Props) {
  const tema = useTheme()
  const angosta = useMediaQuery(tema.breakpoints.down('md'))
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capaFotos = useRef<L.LayerGroup | null>(null)
  const capaLugares = useRef<L.LayerGroup | null>(null)
  const [puntos, setPuntos] = useState<Punto[] | null>(null)
  const [sinGps, setSinGps] = useState(0)
  // Cada vez que el mapa se mueve o acerca se vuelven a juntar las fotos.
  const [vuelta, setVuelta] = useState(0)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Partial<Lugar> | null>(null)
  const [menu, setMenu] = useState<{ lugar: Lugar; ancla: HTMLElement } | null>(null)
  const encuadrado = useRef(false)
  const abrirRef = useRef(alAbrir)
  abrirRef.current = alAbrir

  // El mapa, una vez.
  useEffect(() => {
    if (!caja.current || mapa.current) return
    const m = L.map(caja.current, { zoomControl: !angosta, attributionControl: true }).setView([-9.19, -75.02], 5)
    L.tileLayer(TESELAS, { maxZoom: 19, attribution: ATRIBUCION }).addTo(m)
    capaLugares.current = L.layerGroup().addTo(m)
    capaFotos.current = L.layerGroup().addTo(m)
    m.on('zoomend', () => setVuelta((v) => v + 1))
    mapa.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(caja.current)
    return () => {
      ro.disconnect()
      m.remove()
      mapa.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Las fotos con GPS de la vista.
  useEffect(() => {
    let vivo = true
    setPuntos(null)
    encuadrado.current = false
    api<{ puntos: Punto[]; sin_gps: number }>(`/api/fototeca/mapa?${consulta}`)
      .then((r) => { if (vivo) { setPuntos(r.puntos); setSinGps(r.sin_gps) } })
      .catch((e) => vivo && avisar('error', e instanceof Error ? e.message : 'No se pudo leer el mapa.'))
    return () => {
      vivo = false
    }
  }, [consulta, avisar])

  // Al llegar las fotos, encuadrarlas (una vez por vista).
  useEffect(() => {
    const m = mapa.current
    if (!m || !puntos?.length || encuadrado.current) return
    encuadrado.current = true
    m.fitBounds(L.latLngBounds(puntos.map((p) => [p[1], p[2]] as [number, number])), { padding: [40, 40], maxZoom: 15 })
  }, [puntos])

  // Los grupos de fotos, con su miniatura (lleva token: se baja como blob).
  useEffect(() => {
    const m = mapa.current
    const capa = capaFotos.current
    if (!m || !capa || !puntos) return
    capa.clearLayers()
    for (const g of agrupar(m, puntos)) {
      const lat = g.reduce((s, p) => s + p[1], 0) / g.length
      const lon = g.reduce((s, p) => s + p[2], 0) / g.length
      const marca = L.marker([lat, lon], { icon: icono(g), title: g.length > 1 ? `${g.length} fotos` : 'Una foto', keyboard: true })
      marca.on('add', () => {
        const img = marca.getElement()?.querySelector('img')
        if (img) void traerImagen(urlMiniatura({ id: g[0][0], version: g[0][3] })).then((u) => { img.src = u }).catch(() => {})
      })
      marca.on('click', async () => {
        if (g.length > 1 && m.getZoom() < CERCA) {
          m.fitBounds(L.latLngBounds(g.map((p) => [p[1], p[2]] as [number, number])), { padding: [60, 60], maxZoom: 18 })
          return
        }
        try {
          const r = await api<Pagina>(`/api/fototeca?ids=${g.map((p) => p[0]).join(',')}&ambito=todo&limite=500`)
          abrirRef.current(r.fotos)
        } catch (e) {
          avisar('error', e instanceof Error ? e.message : 'No se pudieron abrir las fotos.')
        }
      })
      capa.addLayer(marca)
    }
  }, [puntos, vuelta, avisar])

  // Los lugares con nombre: un círculo con su nombre.
  useEffect(() => {
    const capa = capaLugares.current
    if (!capa) return
    capa.clearLayers()
    for (const l of lugares) {
      if (l.lat === null || l.lon === null) continue
      L.circle([l.lat, l.lon], { radius: l.radio_m, color: PALETA.acento, weight: 1.5, fillOpacity: 0.08 })
        .bindTooltip(`${l.nombre} · ${l.n} foto${l.n === 1 ? '' : 's'}`, { direction: 'top' })
        .addTo(capa)
    }
  }, [lugares])

  // «Nuevo lugar»: una cruz fija en el centro; se mueve el mapa debajo y «Poner aquí» toma el centro (en el
  // celular un toque se confunde con arrastrar; la cruz no).
  function ponerAqui() {
    const c = mapa.current?.getCenter()
    setCreando(false)
    if (c) setEditando({ lat: c.lat, lon: c.lng, radio_m: 200, nombre: '' })
  }

  async function guardarLugar(l: Partial<Lugar>) {
    try {
      const cuerpo = JSON.stringify({ nombre: l.nombre?.trim(), lat: l.lat, lon: l.lon, radio_m: Math.round(l.radio_m ?? 200) })
      const r = await api<Lugar>(l.id ? `/api/fototeca/lugares/${l.id}` : '/api/fototeca/lugares', { method: l.id ? 'PATCH' : 'POST', body: cuerpo })
      setEditando(null)
      alCambiarLugares()
      if (!l.id) await cercanas(r)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo guardar el lugar.')
    }
  }
  async function cercanas(l: Lugar) {
    try {
      const sim = await api<{ n: number }>(`/api/fototeca/lugares/${l.id}/cercanas`, { method: 'POST' })
      if (!sim.n) return avisar('info', `Ninguna foto sin lugar cae dentro de «${l.nombre}».`)
      if (!(await confirmar(`${sim.n} foto${sim.n === 1 ? '' : 's'} con GPS dentro de «${l.nombre}» no tiene${sim.n === 1 ? '' : 'n'} lugar. ¿Ponerla${sim.n === 1 ? '' : 's'} en este lugar?`, { aceptar: 'Asignar' }))) return
      await api(`/api/fototeca/lugares/${l.id}/cercanas?aplicar=true`, { method: 'POST' })
      avisar('success', `${sim.n} foto${sim.n === 1 ? '' : 's'} en «${l.nombre}».`)
      alCambiarLugares()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo asignar.')
    }
  }
  async function quitar(l: Lugar) {
    if (!(await confirmar(`¿Quitar el lugar «${l.nombre}»? Sus ${l.n} fotos conservan sus coordenadas y el nombre escrito.`, { aceptar: 'Quitar', peligro: true }))) return
    try {
      await api(`/api/fototeca/lugares/${l.id}`, { method: 'DELETE' })
      alCambiarLugares()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo quitar el lugar.')
    }
  }
  const ir = (l: Lugar) => mapa.current?.setView([l.lat!, l.lon!], Math.max(mapa.current.getZoom(), 16))

  const resumen = useMemo(() => {
    if (!puntos) return 'Cargando…'
    const con = `${puntos.length} foto${puntos.length === 1 ? '' : 's'} con GPS`
    return sinGps ? `${con} · ${sinGps} sin GPS` : con
  }, [puntos, sinGps])

  return (
    <Box sx={{ display: 'flex', flexDirection: angosta ? 'column' : 'row', gap: 1.5, height: angosta ? 'auto' : 'calc(100dvh - 210px)', minHeight: 360 }}>
      <Box sx={{ position: 'relative', flex: 1, minHeight: angosta ? '58dvh' : 0, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <Box ref={caja} sx={{ position: 'absolute', inset: 0, '& .mediateca-pin': { background: 'none', border: 0 } }} />
        <Box sx={{ position: 'absolute', left: 8, top: 8, zIndex: 500, px: 1, py: 0.25, borderRadius: 1, bgcolor: PALETA.barra, boxShadow: PALETA.sombra }}>
          <Typography variant="caption">{resumen}</Typography>
        </Box>
        {creando && (
          <>
            <Box aria-hidden sx={{ position: 'absolute', left: '50%', top: '50%', width: 28, height: 28, ml: '-14px', mt: '-14px', zIndex: 500, pointerEvents: 'none',
              '&::before, &::after': { content: '""', position: 'absolute', bgcolor: PALETA.acento, boxShadow: '0 0 0 1px #fff' },
              '&::before': { left: 13, top: 0, width: 2, height: 28 }, '&::after': { top: 13, left: 0, height: 2, width: 28 } }} />
            <Box sx={{ position: 'absolute', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 500, width: 'max-content', maxWidth: 'calc(100% - 16px)', flexWrap: 'wrap', justifyContent: 'center', px: 1.25, py: 0.5, borderRadius: 1, bgcolor: PALETA.barra, boxShadow: PALETA.sombra, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption">Mueva el mapa al centro del lugar</Typography>
              <Button size="small" onClick={() => setCreando(false)}>Cancelar</Button>
              <Button size="small" variant="contained" onClick={ponerAqui}>Poner aquí</Button>
            </Box>
          </>
        )}
      </Box>

      {/* Los lugares con nombre. */}
      <Box sx={{ width: angosta ? '100%' : 300, flexShrink: 0, overflowY: 'auto', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography sx={{ fontWeight: 650, fontSize: 14.5, flex: 1 }}>Lugares</Typography>
          {!soloLectura && (
            <Button size="small" startIcon={<AddLocationAltOutlinedIcon />} onClick={() => setCreando(true)} disabled={creando}>Nuevo lugar</Button>
          )}
        </Box>
        {lugares.length === 0 && (
          <Typography variant="body2" color="text.secondary">Aún no hay lugares con nombre. Créelos para agrupar las fotos de un mismo sitio.</Typography>
        )}
        {lugares.map((l) => (
          <Box key={l.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <IconButton size="small" onClick={() => ir(l)} aria-label={`Ir a ${l.nombre} en el mapa`}><PlaceOutlinedIcon fontSize="small" /></IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 13.5 }}>{l.nombre}</Typography>
              <Typography variant="caption" color="text.secondary">{l.n} foto{l.n === 1 ? '' : 's'} · {l.radio_m} m</Typography>
            </Box>
            {l.n > 0 && <Button size="small" onClick={() => alVerLugar(l.nombre)}>Ver fotos</Button>}
            {!soloLectura && (
              <IconButton size="small" onClick={(e) => setMenu({ lugar: l, ancla: e.currentTarget })} aria-label={`Más acciones de ${l.nombre}`}><MoreVertIcon fontSize="small" /></IconButton>
            )}
          </Box>
        ))}
      </Box>
      <Menu anchorEl={menu?.ancla} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { const l = menu!.lugar; setMenu(null); void cercanas(l) }}><PlaceOutlinedIcon fontSize="small" sx={{ mr: 1 }} />Poner aquí las fotos cercanas</MenuItem>
        <MenuItem onClick={() => { const l = menu!.lugar; setMenu(null); setEditando(l) }}><EditOutlinedIcon fontSize="small" sx={{ mr: 1 }} />Nombre y radio</MenuItem>
        <MenuItem onClick={() => { const l = menu!.lugar; setMenu(null); void quitar(l) }}><DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />Quitar el lugar</MenuItem>
      </Menu>
      <DialogoLugar lugar={editando} alCerrar={() => setEditando(null)} alGuardar={(l) => void guardarLugar(l)} />
    </Box>
  )
}
