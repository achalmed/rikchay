/**
 * FILTROS de la Mediateca (2026-10-19): la búsqueda facetada de digiKam. Cada faceta (año, ámbito, selección,
 * color, calificación, etiqueta, persona, lugar, cámara, medio, uso) muestra cuántas fotos quedarían con cada
 * valor JUNTO con lo demás que ya está puesto (`GET /api/fototeca/facetas/busqueda`, que suelta solo el filtro
 * de la propia faceta). Elegir un valor lo suma a la dirección; volver a pulsarlo lo quita. Los filtros se
 * conservan al cambiar de vista en el panel; «Todas» los quita.
 *
 * `FiltrosActivos` es la fila de pastillas encima de la cuadrícula: lo que está puesto, con su ✕.
 */
import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import { api } from '@qillqa/tiqsi'
import { COLORES, SELECCIONES, hexColor } from './modelo'

type Opcion = { valor: string | number; n: number }
export type Facetado = Record<string, Opcion[]>

/** Los parámetros de la dirección que son filtros (se suman entre sí y a la vista del panel). */
export const CLAVES_FILTRO = ['anio', 'ambito', 'seleccion', 'color', 'calificacion', 'etiqueta', 'persona', 'lugar', 'camara', 'medio', 'uso'] as const

const TITULOS: Record<string, string> = {
  anio: 'Año', ambito: 'Ámbito', seleccion: 'Selección', color: 'Color', calificacion: 'Calificación', etiqueta: 'Etiqueta',
  persona: 'Persona', lugar: 'Lugar', camara: 'Cámara', medio: 'Medio', uso: 'Uso',
}
const NOMBRES: Record<string, Record<string, string>> = {
  ambito: { actividad: 'Actividades', marca: 'Marca', prensa: 'Prensa' },
  medio: { foto: 'Fotos', video: 'Videos', documento: 'Documentos' },
  uso: { con: 'Se usa en algo', sin: 'Sin usar' },
  seleccion: { ...Object.fromEntries(SELECCIONES.map((s) => [s.valor, s.plural])), ninguna: 'Sin marcar' },
  color: Object.fromEntries(COLORES.map((c) => [c.valor, c.etiqueta])),
}
/** Cómo se lee un filtro puesto («2026», «Canon EOS R6», «4 estrellas o más»). */
export function nombreFiltro(clave: string, valor: string): string {
  if (clave === 'calificacion') return `${valor} estrella${valor === '1' ? '' : 's'} o más`
  if (clave === 'ambito' && valor === 'todo') return 'Todo'
  return NOMBRES[clave]?.[valor] ?? valor
}

const CORTO = 12

function Faceta({ clave, opciones, actual, alElegir }: { clave: string; opciones: Opcion[]; actual: string | null; alElegir: (v: string | null) => void }) {
  const [todas, setTodas] = useState(false)
  // La calificación se elige como mínimo: cada opción cuenta las que tienen al menos esas estrellas.
  const lista: Opcion[] = clave === 'calificacion'
    ? [5, 4, 3, 2, 1].map((k) => ({ valor: k, n: opciones.filter((o) => Number(o.valor) >= k).reduce((s, o) => s + o.n, 0) })).filter((o) => o.n > 0)
    : opciones
  if (!lista.length && !actual) return null
  const visibles = todas ? lista : lista.slice(0, CORTO)
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{TITULOS[clave]}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {visibles.map((o) => {
          const v = String(o.valor)
          const activo = actual === v
          const punto = clave === 'color' ? hexColor(v) : undefined
          return (
            <Chip key={v} size="small" clickable color={activo ? 'primary' : 'default'} variant={activo ? 'filled' : 'outlined'}
              icon={punto ? <Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: punto, ml: '6px !important', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} /> : undefined}
              label={`${clave === 'calificacion' ? `${v}+ ★` : nombreFiltro(clave, v)} · ${o.n}`}
              onClick={() => alElegir(activo ? null : v)} />
          )
        })}
        {lista.length > CORTO && (
          <Button size="small" onClick={() => setTodas(!todas)}>{todas ? 'Menos' : `Todas (${lista.length})`}</Button>
        )}
      </Box>
    </Box>
  )
}

interface Props {
  abierto: boolean
  alCerrar: () => void
  /** La consulta de la lista (los mismos filtros). */
  consulta: string
  p: URLSearchParams
  ir: (cambios: Record<string, string | null>) => void
  total: number
}

export default function Filtros({ abierto, alCerrar, consulta, p, ir, total }: Props) {
  const tema = useTheme()
  const angosta = useMediaQuery(tema.breakpoints.down('md'))
  const [datos, setDatos] = useState<Facetado | null>(null)
  useEffect(() => {
    if (!abierto) return
    let vivo = true
    api<Facetado>(`/api/fototeca/facetas/busqueda?${consulta}`).then((d) => vivo && setDatos(d)).catch(() => vivo && setDatos({}))
    return () => {
      vivo = false
    }
  }, [abierto, consulta])
  const puestos = CLAVES_FILTRO.filter((k) => p.get(k))
  return (
    <Drawer anchor={angosta ? 'bottom' : 'right'} open={abierto} onClose={alCerrar}
      PaperProps={{ sx: angosta ? { maxHeight: '85dvh', borderTopLeftRadius: 14, borderTopRightRadius: 14 } : { width: 360 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5, pb: 1, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 }}>
        <Typography sx={{ fontWeight: 650, fontSize: 16, flex: 1 }}>Filtros</Typography>
        {puestos.length > 0 && <Button size="small" onClick={() => ir(Object.fromEntries(puestos.map((k) => [k, null])))}>Quitar todos</Button>}
        <IconButton size="small" onClick={alCerrar} aria-label="Cerrar los filtros"><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>
        {!datos ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={24} /></Box>
        ) : (
          CLAVES_FILTRO.map((k) => <Faceta key={k} clave={k} opciones={datos[k] ?? []} actual={p.get(k)} alElegir={(v) => ir({ [k]: v })} />)
        )}
      </Box>
      {angosta && (
        <Box sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button fullWidth variant="contained" onClick={alCerrar}>Ver {total} foto{total === 1 ? '' : 's'}</Button>
        </Box>
      )}
    </Drawer>
  )
}

export function FiltrosActivos({ p, ir }: { p: URLSearchParams; ir: (cambios: Record<string, string | null>) => void }) {
  const puestos = CLAVES_FILTRO.filter((k) => p.get(k))
  if (!puestos.length) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1, alignItems: 'center' }}>
      {puestos.map((k) => (
        <Chip key={k} size="small" variant="outlined" label={`${TITULOS[k]}: ${nombreFiltro(k, p.get(k)!)}`} onDelete={() => ir({ [k]: null })} />
      ))}
      {puestos.length > 1 && <Button size="small" onClick={() => ir(Object.fromEntries(puestos.map((k) => [k, null])))}>Quitar filtros</Button>}
    </Box>
  )
}
