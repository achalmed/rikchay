/**
 * VERSIONES de una foto (2026-10-19; `GET /api/fototeca/{id}/versiones`): el original y lo que salió de él
 * (la edición que cita una semana, un recorte, una exportación), como el historial de digiKam. Las versiones no
 * salen sueltas en la cuadrícula: se ven desde su original, aquí, y tocarlas las muestra en el mismo visor.
 */
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { PALETA } from '@qillqa/tiqsi'
import { type Foto, traerImagen, urlMiniatura } from './modelo'

export interface DatosVersiones {
  original: Foto | null
  es_version: boolean
  versiones: Foto[]
}

const TIPOS: Record<string, string> = { edicion: 'Edición', recorte: 'Recorte', exportacion: 'Pieza de prensa' }

function Miniatura({ foto }: { foto: Foto }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let vivo = true
    traerImagen(urlMiniatura(foto)).then((u) => vivo && setUrl(u)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [foto])
  return <Box sx={{ width: 64, height: 64, borderRadius: 1, bgcolor: 'action.hover', backgroundImage: url ? `url(${url})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }} />
}

function rotulo(f: Foto): string {
  const v = f.version_de
  if (!v) return 'Original'
  const dia = v.creado_en ? new Date(v.creado_en).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }) : ''
  return [TIPOS[v.tipo] ?? v.tipo, dia].filter(Boolean).join(' · ')
}

export default function Versiones({ datos, actual, alElegir }: { datos: DatosVersiones; actual: number; alElegir: (f: Foto) => void }) {
  if (!datos.original || !datos.versiones.length) return null
  const todas = [datos.original, ...datos.versiones]
  return (
    <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
      {todas.map((f) => {
        const activa = f.id === actual
        const usos = (f.vinculos ?? []).map((v) => v.etiqueta).filter(Boolean)
        return (
          <Box key={f.id} component="button" type="button" onClick={() => alElegir(f)} aria-pressed={activa}
            title={usos.length ? `Se usa en ${usos.join(', ')}` : undefined}
            sx={{ flexShrink: 0, width: 72, p: 0.5, border: '1px solid', borderColor: activa ? PALETA.guinda : 'divider', borderRadius: 1.5,
              bgcolor: activa ? PALETA.guindaSuave : 'transparent', cursor: 'pointer', font: 'inherit', color: 'text.primary', textAlign: 'center' }}>
            <Miniatura foto={f} />
            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.25, mt: 0.5, fontWeight: activa ? 650 : 400 }}>{rotulo(f)}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}
