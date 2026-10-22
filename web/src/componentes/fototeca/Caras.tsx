/**
 * CARAS de la Mediateca (2026-10-19; backend/app/servicios/caras.py): quién aparece en la foto y dónde.
 *
 *   - `CapaCaras`: la foto SIN ajustes (las regiones se miden sobre ella: un recorte del editor no las mueve) con
 *     sus caras encima. Arrastrar marca una cara nueva; tocar una la elige. Las propuestas del detector se ven
 *     con línea punteada hasta que alguien les pone nombre: nada entra a la base sin confirmación humana.
 *   - `PreguntaCara`: «¿Quién es?» sobre la foto, para la cara elegida (nueva, propuesta o ya marcada).
 *   - `AvatarCara`: el recorte por cara (el retrato de la persona en esa foto), con su token.
 */
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import { PALETA } from '@qillqa/tiqsi'
import { type Foto, traerImagen, urlCruda } from './modelo'

export interface Cara {
  id: number
  foto_id: number
  persona_id: number | null
  persona: string
  x: number
  y: number
  ancho: number
  alto: number
  confianza: number | null
  origen: 'manual' | 'modelo'
}
export type Caja = Pick<Cara, 'x' | 'y' | 'ancho' | 'alto'>
export type Propuesta = Caja & { confianza: number | null }
/** Lo que está elegido en la capa: una cara marcada, una propuesta del detector o una recién dibujada. */
export type Elegida =
  | { tipo: 'cara'; cara: Cara }
  | { tipo: 'propuesta'; indice: number; caja: Propuesta }
  | { tipo: 'nueva'; caja: Caja }

export const urlRecorte = (c: Pick<Cara, 'id' | 'x' | 'y' | 'ancho' | 'alto'>, lado = 128) =>
  `/api/fototeca/caras/${c.id}/recorte?lado=${lado}&v=${[c.x, c.y, c.ancho, c.alto].map((n) => n.toFixed(4)).join('-')}`

export function AvatarCara({ ruta, nombre, tam = 28 }: { ruta: string; nombre: string; tam?: number }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let vivo = true
    traerImagen(ruta).then((u) => vivo && setUrl(u)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [ruta])
  return <Avatar src={url || undefined} alt={nombre} sx={{ width: tam, height: tam, fontSize: tam * 0.45 }}>{nombre.slice(0, 1).toUpperCase()}</Avatar>
}

const pct = (n: number) => `${(n * 100).toFixed(3)}%`

interface CapaProps {
  foto: Foto
  caras: Cara[]
  propuestas: Propuesta[]
  elegida: Elegida | null
  alElegir: (e: Elegida | null) => void
  soloLectura: boolean
}

export default function CapaCaras({ foto, caras, propuestas, elegida, alElegir, soloLectura }: CapaProps) {
  const marco = useRef<HTMLDivElement>(null)
  const capa = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState('')
  const [medida, setMedida] = useState({ w: 0, h: 0 })
  const [arrastre, setArrastre] = useState<Caja | null>(null)
  const inicio = useRef<{ x: number; y: number } | null>(null)
  const proporcion = (foto.ancho || 1) / (foto.alto || 1)

  useEffect(() => {
    let vivo = true
    setUrl('')
    traerImagen(urlCruda(foto.id)).then((u) => vivo && setUrl(u)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [foto.id])
  // La capa mide exactamente lo que la foto (contenida en su marco): así las cajas van en % de la foto.
  useEffect(() => {
    const el = marco.current
    if (!el) return
    const medir = () => {
      const { width, height } = el.getBoundingClientRect()
      const w = Math.min(width, height * proporcion)
      setMedida({ w, h: w / proporcion })
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [proporcion])

  const relativo = (e: React.PointerEvent) => {
    const r = capa.current!.getBoundingClientRect()
    return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) }
  }
  const caja = (a: { x: number; y: number }, b: { x: number; y: number }): Caja => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), ancho: Math.abs(a.x - b.x), alto: Math.abs(a.y - b.y),
  })

  const rectangulo = (c: Caja, clave: string, estilo: 'cara' | 'propuesta' | 'nueva', activa: boolean, rotulo: string, alPulsar?: () => void) => (
    <Box key={clave} role={alPulsar ? 'button' : undefined} aria-label={rotulo || 'Cara sin nombre'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); alPulsar?.() }}
      sx={{
        position: 'absolute', left: pct(c.x), top: pct(c.y), width: pct(c.ancho), height: pct(c.alto), cursor: alPulsar ? 'pointer' : 'default',
        border: `2px ${estilo === 'propuesta' ? 'dashed' : 'solid'} ${activa ? '#fff' : 'rgba(255,255,255,.75)'}`,
        boxShadow: activa ? '0 0 0 2px rgba(0,0,0,.55), 0 0 0 9999px rgba(0,0,0,.25)' : '0 0 0 1px rgba(0,0,0,.45)', borderRadius: 1,
      }}>
      {rotulo && (
        <Box component="span" sx={{
          position: 'absolute', left: -2, top: '100%', mt: '3px', px: 0.75, py: 0.1, fontSize: 12, lineHeight: 1.5, whiteSpace: 'nowrap',
          color: '#fff', bgcolor: 'rgba(0,0,0,.62)', borderRadius: 0.75, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{rotulo}</Box>
      )}
    </Box>
  )

  return (
    <Box ref={marco} sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box ref={capa}
        onPointerDown={(e) => {
          if (soloLectura || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          inicio.current = relativo(e)
          setArrastre(null)
        }}
        onPointerMove={(e) => inicio.current && setArrastre(caja(inicio.current, relativo(e)))}
        onPointerUp={(e) => {
          const a = inicio.current ? caja(inicio.current, relativo(e)) : null
          inicio.current = null
          setArrastre(null)
          if (a && a.ancho > 0.015 && a.alto > 0.015) alElegir({ tipo: 'nueva', caja: a })
          else if (a) alElegir(null) // un toque fuera de las caras suelta la elegida
        }}
        sx={{
          position: 'relative', width: medida.w, height: medida.h, flexShrink: 0, touchAction: 'none', userSelect: 'none', overflow: 'hidden',
          cursor: soloLectura ? 'default' : 'crosshair', backgroundImage: url ? `url(${url})` : 'none', backgroundSize: '100% 100%',
        }}>
        {!url && <CircularProgress sx={{ color: '#fff', position: 'absolute', left: '50%', top: '50%', ml: '-20px', mt: '-20px' }} />}
        {caras.map((c) => rectangulo(c, `c${c.id}`, 'cara', elegida?.tipo === 'cara' && elegida.cara.id === c.id, c.persona || '¿Quién es?', () => alElegir({ tipo: 'cara', cara: c })))}
        {propuestas.map((c, i) => rectangulo(c, `p${i}`, 'propuesta', elegida?.tipo === 'propuesta' && elegida.indice === i,
          `Propuesta${c.confianza ? ` · ${Math.round(c.confianza * 100)} %` : ''}`, () => alElegir({ tipo: 'propuesta', indice: i, caja: c })))}
        {elegida?.tipo === 'nueva' && rectangulo(elegida.caja, 'nueva', 'nueva', true, 'Nueva')}
        {arrastre && rectangulo(arrastre, 'arrastre', 'nueva', true, '')}
      </Box>
    </Box>
  )
}

interface PreguntaProps {
  elegida: Elegida
  personas: string[]
  ocupado: boolean
  alGuardar: (nombre: string) => void
  /** Quitar la cara marcada o descartar la propuesta / la nueva. */
  alQuitar: () => void
  alCerrar: () => void
}

export function PreguntaCara({ elegida, personas, ocupado, alGuardar, alQuitar, alCerrar }: PreguntaProps) {
  // Que la pregunta no tape la cara: arriba si la cara está en la mitad de abajo.
  const c = elegida.tipo === 'cara' ? elegida.cara : elegida.caja
  const arriba = c.y + c.alto / 2 > 0.5
  const inicial = elegida.tipo === 'cara' ? elegida.cara.persona : ''
  const [nombre, setNombre] = useState(inicial)
  useEffect(() => setNombre(inicial), [elegida, inicial])
  const titulo = elegida.tipo === 'cara' ? (elegida.cara.persona ? 'Cara marcada' : '¿Quién es?') : elegida.tipo === 'propuesta' ? 'Propuesta del detector: ¿quién es?' : '¿Quién es?'
  return (
    <Paper elevation={8} onPointerDown={(e) => e.stopPropagation()}
      sx={{ position: 'absolute', left: '50%', ...(arriba ? { top: { xs: 52, md: 64 } } : { bottom: { xs: 8, md: 24 } }), transform: 'translateX(-50%)', zIndex: 2, p: 1.5, width: 360, maxWidth: 'calc(100% - 16px)' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{titulo}</Typography>
      <Autocomplete freeSolo size="small" options={personas} inputValue={nombre}
        onInputChange={(_, v) => setNombre(v)} onChange={(_, v) => setNombre(v ?? '')}
        renderInput={(p) => (
          <TextField {...p} autoFocus placeholder="Nombre de la persona"
            onKeyDown={(e) => { if (e.key === 'Enter' && nombre.trim()) { e.preventDefault(); alGuardar(nombre.trim()) } if (e.key === 'Escape') { e.stopPropagation(); alCerrar() } }} />
        )} />
      <Box sx={{ display: 'flex', gap: 1, mt: 1.25, alignItems: 'center' }}>
        <Button size="small" color={elegida.tipo === 'cara' ? 'error' : 'inherit'} onClick={alQuitar} disabled={ocupado}>
          {elegida.tipo === 'cara' ? 'Quitar la cara' : 'Descartar'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={alCerrar} disabled={ocupado}>Cancelar</Button>
        <Button size="small" variant="contained" disabled={ocupado || !nombre.trim() || nombre.trim() === inicial} onClick={() => alGuardar(nombre.trim())}>
          Guardar
        </Button>
      </Box>
    </Paper>
  )
}

/** Las caras de la foto en la ficha: retrato, nombre y la propuesta pendiente. */
export function ListaCaras({ caras, propuestas, alElegir }: { caras: Cara[]; propuestas: Propuesta[]; alElegir: (e: Elegida) => void }) {
  if (!caras.length && !propuestas.length) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {caras.map((c) => (
        <Box key={c.id} component="button" type="button" onClick={() => alElegir({ tipo: 'cara', cara: c })}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 0.4, pr: 1, py: 0.4, border: '1px solid', borderColor: 'divider', borderRadius: 4,
            bgcolor: 'transparent', cursor: 'pointer', color: 'text.primary', font: 'inherit', fontSize: 13 }}>
          <AvatarCara ruta={urlRecorte(c)} nombre={c.persona || '?'} tam={24} />
          {c.persona || <Box component="span" sx={{ color: PALETA.aviso }}>¿Quién es?</Box>}
        </Box>
      ))}
      {propuestas.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          {propuestas.length} propuesta{propuestas.length === 1 ? '' : 's'} por confirmar: tóquela{propuestas.length === 1 ? '' : 's'} en la foto
        </Typography>
      )}
    </Box>
  )
}
