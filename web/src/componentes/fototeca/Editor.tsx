/**
 * EDITOR de la Fototeca: girar, voltear, enderezar, recortar (libre o con las
 * proporciones de la entidad: informe 3:2, publicación 4:5, cuadrada, historia
 * 9:16) y luz / contraste / color, con vista previa en vivo.
 *
 * Es NO destructivo: «Guardar» solo guarda los ajustes en el servidor; el
 * original no cambia y «Restablecer» vuelve a él. La geometría se dibuja en un
 * lienzo con el mismo cálculo del servidor (modelo.ts ⇄ servicios/fototeca.py)
 * y el color se previsualiza con un filtro CSS; el recorte va encima, como un
 * marco que se arrastra por el centro o por sus esquinas.
 */
import { useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Slider from '@mui/material/Slider'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import FlipIcon from '@mui/icons-material/Flip'
import AutoFixHighOutlinedIcon from '@mui/icons-material/AutoFixHighOutlined'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import { api, PALETA } from '@qillqa/tiqsi'
import { PRESETS, type Ajustes, type Foto, bajar, dibujarEncuadre, exportar, filtroCss, recorteCentrado, traerImagen, urlCruda } from './modelo'

type Recorte = [number, number, number, number]
type Asa = 'mover' | 'no' | 'ne' | 'so' | 'se'

const PROPORCIONES: { clave: string; etiqueta: string; valor: number | null }[] = [
  { clave: 'libre', etiqueta: 'Libre', valor: null },
  { clave: 'informe', etiqueta: 'Informe 3:2', valor: 3 / 2 },
  { clave: 'publicacion', etiqueta: '4:5', valor: 4 / 5 },
  { clave: 'cuadrada', etiqueta: '1:1', valor: 1 },
  { clave: 'historia', etiqueta: '9:16', valor: 9 / 16 },
  { clave: 'horizontal', etiqueta: '16:9', valor: 16 / 9 },
]
const COMPLETO: Recorte = [0, 0, 1, 1]
const MINIMO = 0.04

interface Props {
  foto: Foto | null
  alCerrar: () => void
  alGuardar: (f: Foto) => void
  avisar: (tipo: 'success' | 'error' | 'info', t: string) => void
}

export default function Editor({ foto, alCerrar, alGuardar, avisar }: Props) {
  const tema = useTheme()
  const angosta = useMediaQuery(tema.breakpoints.down('md'))
  const lienzo = useRef<HTMLCanvasElement>(null)
  // Por estado y no por ref: el diálogo monta su contenido un render DESPUÉS (portal),
  // y un efecto atado a la ref no volvería a medir.
  const [zona, setZona] = useState<HTMLDivElement | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [aj, setAj] = useState<Ajustes>({})
  const [recorte, setRecorte] = useState<Recorte>(COMPLETO)
  const [proporcion, setProporcion] = useState<string>('libre')
  const [medidas, setMedidas] = useState({ w: 1, h: 1 })
  const [espacio, setEspacio] = useState({ w: 0, h: 0 })
  const [guardando, setGuardando] = useState(false)
  const [menuExportar, setMenuExportar] = useState<HTMLElement | null>(null)
  const arrastre = useRef<{ asa: Asa; x: number; y: number; inicial: Recorte } | null>(null)

  // La base del editor es la vista SIN ajustes (los ajustes se aplican aquí).
  useEffect(() => {
    if (!foto) return
    setAj({ ...foto.ajustes, recorte: undefined })
    setRecorte(foto.ajustes.recorte ?? COMPLETO)
    setProporcion('libre')
    setImg(null)
    let vivo = true
    traerImagen(urlCruda(foto.id))
      .then((u) => {
        const i = new Image()
        i.onload = () => vivo && setImg(i)
        i.src = u
      })
      .catch(() => avisar('error', 'No se pudo abrir la foto para editarla.'))
    return () => {
      vivo = false
    }
  }, [foto]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redibujar el encuadre cuando cambia la geometría.
  useEffect(() => {
    if (!img || !lienzo.current) return
    dibujarEncuadre(lienzo.current, img, aj)
    setMedidas({ w: lienzo.current.width, h: lienzo.current.height })
  }, [img, aj.rotar, aj.voltear, aj.voltear_v, aj.enderezar]) // eslint-disable-line react-hooks/exhaustive-deps

  // Espacio disponible para la foto (el lienzo se escala para caber).
  useEffect(() => {
    if (!zona) return
    const obs = new ResizeObserver(([e]) => setEspacio({ w: e.contentRect.width, h: e.contentRect.height }))
    obs.observe(zona)
    return () => obs.disconnect()
  }, [zona])

  const escala = Math.min(espacio.w / medidas.w, espacio.h / medidas.h) || 0
  const vista = { w: Math.floor(medidas.w * escala), h: Math.floor(medidas.h * escala) }
  const prop = PROPORCIONES.find((p) => p.clave === proporcion)?.valor ?? null

  if (!foto) return null

  const girar = (grados: number) => {
    setAj((a) => ({ ...a, rotar: (((a.rotar ?? 0) + grados) % 360 + 360) % 360 }))
    setRecorte(COMPLETO) // el recorte es relativo al encuadre: al girar, se rehace
    setProporcion('libre')
  }
  const voltear = (clave: 'voltear' | 'voltear_v') => {
    setAj((a) => ({ ...a, [clave]: !a[clave] }))
    setRecorte(([x, y, w, h]) => (clave === 'voltear' ? [1 - x - w, y, w, h] : [x, 1 - y - h, w, h]))
  }
  const elegirProporcion = (clave: string) => {
    setProporcion(clave)
    const v = PROPORCIONES.find((p) => p.clave === clave)?.valor
    setRecorte(v ? recorteCentrado(medidas.w, medidas.h, v) : COMPLETO)
  }
  const restablecer = () => {
    setAj({})
    setRecorte(COMPLETO)
    setProporcion('libre')
  }
  async function automatico() {
    try {
      const s = await api<Ajustes>(`/api/fototeca/${foto!.id}/sugerir-ajustes`)
      setAj((a) => ({ ...a, brillo: s.brillo ?? 1, contraste: s.contraste ?? 1, saturacion: s.saturacion ?? 1 }))
      avisar('info', 'Mejora automática propuesta: revise y guarde si le parece bien.')
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo calcular la mejora.')
    }
  }
  const ajustesFinales = (): Ajustes => ({ ...aj, recorte: recorte.join() === COMPLETO.join() ? undefined : recorte })
  async function guardar(): Promise<Foto | null> {
    setGuardando(true)
    try {
      const nueva = await api<Foto>(`/api/fototeca/${foto!.id}`, { method: 'PATCH', body: JSON.stringify({ ajustes: ajustesFinales() }) })
      alGuardar(nueva)
      return nueva
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudieron guardar los ajustes.')
      return null
    } finally {
      setGuardando(false)
    }
  }
  async function guardarYExportar(preset: string) {
    setMenuExportar(null)
    const nueva = await guardar()
    if (!nueva) return
    try {
      const { blob, nombre } = await exportar([nueva.id], preset)
      bajar(blob, nombre)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo exportar.')
    }
  }

  // --- Arrastre del recorte (ratón, dedo o lápiz) ------------------------------------------
  const empezar = (asa: Asa) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    arrastre.current = { asa, x: e.clientX, y: e.clientY, inicial: recorte }
  }
  const mover = (e: React.PointerEvent) => {
    const a = arrastre.current
    if (!a || !vista.w) return
    const dx = (e.clientX - a.x) / vista.w
    const dy = (e.clientY - a.y) / vista.h
    let [x, y, w, h] = a.inicial
    if (a.asa === 'mover') {
      x = Math.min(1 - w, Math.max(0, x + dx))
      y = Math.min(1 - h, Math.max(0, y + dy))
      setRecorte([x, y, w, h])
      return
    }
    // Esquinas: la opuesta queda fija.
    const derecha = a.asa === 'ne' || a.asa === 'se'
    const abajo = a.asa === 'so' || a.asa === 'se'
    const fijoX = derecha ? x : x + w
    const fijoY = abajo ? y : y + h
    let nw = Math.max(MINIMO, derecha ? Math.min(1 - x, w + dx) : Math.min(x + w, w - dx))
    let nh = Math.max(MINIMO, abajo ? Math.min(1 - y, h + dy) : Math.min(y + h, h - dy))
    if (prop) {
      // Proporción fija en PÍXELES: alto relativo = ancho relativo · W / (H · prop).
      const factor = medidas.w / (medidas.h * prop)
      const limiteW = derecha ? 1 - fijoX : fijoX
      const limiteH = abajo ? 1 - fijoY : fijoY
      nh = nw * factor
      if (nh > limiteH) {
        nh = limiteH
        nw = nh / factor
      }
      if (nw > limiteW) {
        nw = limiteW
        nh = nw * factor
      }
    }
    x = derecha ? fijoX : fijoX - nw
    y = abajo ? fijoY : fijoY - nh
    setRecorte([x, y, nw, nh])
  }
  const soltar = () => {
    arrastre.current = null
  }

  const [rx, ry, rw, rh] = recorte
  const asa = (posicion: Exclude<Asa, 'mover'>, sx: object) => (
    <Box onPointerDown={empezar(posicion)}
      sx={{ position: 'absolute', width: 22, height: 22, borderColor: '#fff', borderStyle: 'solid', borderWidth: 0, touchAction: 'none', ...sx }} />
  )
  const deslizador = (clave: 'brillo' | 'contraste' | 'saturacion', etiqueta: string) => (
    <Box sx={{ px: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption">{etiqueta}</Typography>
        <Typography variant="caption" color="text.secondary">{Math.round(((aj[clave] ?? 1) - 1) * 100)}</Typography>
      </Box>
      <Slider size="small" min={0.5} max={1.5} step={0.01} value={aj[clave] ?? 1}
        onChange={(_, v) => setAj((a) => ({ ...a, [clave]: v as number }))}
        onDoubleClick={() => setAj((a) => ({ ...a, [clave]: 1 }))} />
    </Box>
  )

  return (
    <Dialog open fullScreen onClose={alCerrar} PaperProps={{ sx: { bgcolor: PALETA.oscuroVisor } }}>
      <Box sx={{ display: 'flex', flexDirection: angosta ? 'column' : 'row', height: '100%' }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, color: '#fff' }}>
            <IconButton onClick={alCerrar} sx={{ color: '#fff' }} aria-label="Cerrar sin guardar"><CloseIcon /></IconButton>
            <Typography noWrap sx={{ fontSize: 14.5, flex: 1 }}>Editar · {foto.titulo || foto.nombre_original}</Typography>
          </Box>
          <Box ref={setZona} sx={{ flex: 1, minHeight: 0, m: { xs: 1.5, md: 3 }, display: 'grid', placeItems: 'center', position: 'relative' }}>
            {!img && <CircularProgress sx={{ color: '#fff', position: 'absolute' }} />}
            <Box sx={{ position: 'relative', width: vista.w, height: vista.h, overflow: 'hidden', visibility: img ? 'visible' : 'hidden' }}
              onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
              <canvas ref={lienzo} style={{ width: '100%', height: '100%', display: 'block', filter: filtroCss(aj) }} />
              {/* El marco del recorte: lo de fuera, velado. */}
              <Box onPointerDown={empezar('mover')}
                sx={{
                  position: 'absolute', left: `${rx * 100}%`, top: `${ry * 100}%`, width: `${rw * 100}%`, height: `${rh * 100}%`,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,.55)', outline: '1px solid rgba(255,255,255,.9)', cursor: 'move', touchAction: 'none',
                  backgroundImage: 'linear-gradient(rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.25) 1px, transparent 1px)',
                  backgroundSize: '33.333% 33.333%', backgroundPosition: '-1px -1px',
                }}>
                {asa('no', { left: -3, top: -3, borderTopWidth: 3, borderLeftWidth: 3, cursor: 'nwse-resize' })}
                {asa('ne', { right: -3, top: -3, borderTopWidth: 3, borderRightWidth: 3, cursor: 'nesw-resize' })}
                {asa('so', { left: -3, bottom: -3, borderBottomWidth: 3, borderLeftWidth: 3, cursor: 'nesw-resize' })}
                {asa('se', { right: -3, bottom: -3, borderBottomWidth: 3, borderRightWidth: 3, cursor: 'nwse-resize' })}
              </Box>
            </Box>
          </Box>
        </Box>

        <Box sx={{ width: angosta ? '100%' : 320, flexShrink: 0, bgcolor: 'background.paper', p: 2, overflowY: 'auto', maxHeight: angosta ? '46dvh' : '100%' }}>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Girar y voltear</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
            <Tooltip title="Girar a la izquierda"><IconButton onClick={() => girar(-90)}><RotateLeftIcon /></IconButton></Tooltip>
            <Tooltip title="Girar a la derecha"><IconButton onClick={() => girar(90)}><RotateRightIcon /></IconButton></Tooltip>
            <Tooltip title="Voltear horizontal (espejo)"><IconButton color={aj.voltear ? 'primary' : 'default'} onClick={() => voltear('voltear')}><FlipIcon /></IconButton></Tooltip>
            <Tooltip title="Voltear vertical"><IconButton color={aj.voltear_v ? 'primary' : 'default'} onClick={() => voltear('voltear_v')}><FlipIcon sx={{ transform: 'rotate(90deg)' }} /></IconButton></Tooltip>
          </Box>
          <Box sx={{ px: 0.5, mb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption">Enderezar</Typography>
              <Typography variant="caption" color="text.secondary">{(aj.enderezar ?? 0).toFixed(1)}°</Typography>
            </Box>
            <Slider size="small" min={-15} max={15} step={0.1} value={aj.enderezar ?? 0} track={false}
              marks={[{ value: 0 }]} onChange={(_, v) => setAj((a) => ({ ...a, enderezar: v as number }))}
              onDoubleClick={() => setAj((a) => ({ ...a, enderezar: 0 }))} />
          </Box>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Recorte</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 0.5 }}>
            {PROPORCIONES.map((p) => (
              <Chip key={p.clave} size="small" label={p.etiqueta} color={proporcion === p.clave ? 'primary' : 'default'}
                variant={proporcion === p.clave ? 'filled' : 'outlined'} onClick={() => elegirProporcion(p.clave)} />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Arrastre el marco o sus esquinas. {Math.round(medidas.w * rw * (foto.ancho / Math.max(1, img?.naturalWidth ?? foto.ancho)))} ×{' '}
            {Math.round(medidas.h * rh * (foto.ancho / Math.max(1, img?.naturalWidth ?? foto.ancho)))} px del original.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>Luz y color</Typography>
            <Button size="small" startIcon={<AutoFixHighOutlinedIcon />} onClick={() => void automatico()}>Automático</Button>
          </Box>
          {deslizador('brillo', 'Brillo')}
          {deslizador('contraste', 'Contraste')}
          {deslizador('saturacion', 'Saturación')}
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button startIcon={<RestartAltIcon />} onClick={restablecer}>Restablecer</Button>
            <Box sx={{ flex: 1 }} />
            <Button startIcon={<FileDownloadOutlinedIcon />} disabled={guardando} onClick={(e) => setMenuExportar(e.currentTarget)}>Exportar</Button>
            <Button variant="contained" disabled={guardando} onClick={async () => { if (await guardar()) { avisar('success', 'Ajustes guardados. El original no cambió.'); alCerrar() } }}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: PALETA.textoTenue }}>
            Los cambios se guardan como ajustes: el original queda intacto y «Restablecer» vuelve a él en cualquier momento.
          </Typography>
        </Box>
      </Box>
      <Menu anchorEl={menuExportar} open={Boolean(menuExportar)} onClose={() => setMenuExportar(null)}>
        <MenuItem disabled sx={{ fontSize: 12.5 }}>Guarda los ajustes y descarga en:</MenuItem>
        {PRESETS.map((p) => <MenuItem key={p.clave} onClick={() => void guardarYExportar(p.clave)}>{p.etiqueta}</MenuItem>)}
      </Menu>
    </Dialog>
  )
}
