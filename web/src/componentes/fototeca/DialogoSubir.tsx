/**
 * Subir con actividad. Por defecto «Subir» sube sin preguntar nada (Edison 2026-10-20: «subir las
 * fotos así nada más, sin pedir actividad ni fecha»): la fecha la pone el archivo (EXIF o nombre) y
 * la Mediateca las ordena sola. Este diálogo es la vía opcional, desde el menú junto a «Subir»,
 * para dejarlas de una vez en una actividad:
 *   - una actividad de una Semana de Representación (semana → actividad): además de entrar a la
 *     Mediateca pasan al banco de trabajo de esa semana y quedan en su álbum «SR-NN · A-NN · …»;
 *   - otra actividad de la entidad (sesión, reunión, evento…): un álbum, existente o nuevo, con
 *     su fecha.
 * Lo elegido se recuerda para la tanda siguiente (se suele subir por actividad).
 */
import { useEffect, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api } from '@qillqa/tiqsi'

interface SemanaLista { id: number; codigo: string; tema: string; inicio: string; fin: string }
interface Actividad { codigo: string; datos: Record<string, unknown> }
interface AlbumLista { id: number; nombre: string; fecha: string; n: number }

export interface EleccionSubida {
  /** Actividad de una Semana de Representación (el servidor crea o reutiliza su álbum). */
  semana: { id: number; actividad: string } | null
  /** Álbum existente de otra actividad. */
  albumId: number | null
  /** Álbum nuevo de otra actividad (se crea antes de subir). */
  nuevoAlbum: { nombre: string; fecha: string } | null
}

const CLAVE = 'qillqa-subida-actividad'
export type Clase = 'semana' | 'otra'

export default function DialogoSubir({ archivos, clase: claseInicial, albumActual, alCerrar, alSubir }: {
  archivos: File[]
  /** Qué se eligió en el menú de «Subir». */
  clase: Clase
  /** Álbum abierto en la Mediateca al soltar las fotos: se propone como actividad. */
  albumActual?: { id: number; nombre: string } | null
  alCerrar: () => void
  alSubir: (e: EleccionSubida) => void
}) {
  const [semanas, setSemanas] = useState<SemanaLista[]>([])
  const [actividades, setActividades] = useState<Actividad[]>([])
  const [albumes, setAlbumes] = useState<AlbumLista[]>([])
  const [clase, setClase] = useState<Clase>(claseInicial)
  const [semanaId, setSemanaId] = useState<number | ''>('')
  const [actividad, setActividad] = useState('')
  const [album, setAlbum] = useState<AlbumLista | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [fechaNueva, setFechaNueva] = useState(() => new Date().toISOString().slice(0, 10))
  useEffect(() => {
    // `/api/semanas` responde { semanas, sin_importar } (no una lista): leerla como lista dejaba
    // el interruptor siempre apagado (auditoría 2026-10-10, MD-01).
    api<{ semanas: SemanaLista[] }>('/api/semanas').then((r) => setSemanas((r.semanas || []).filter((s) => s.id))).catch(() => setSemanas([]))
    api<{ albumes: AlbumLista[] }>('/api/fototeca/facetas').then((r) => setAlbumes(r.albumes || [])).catch(() => setAlbumes([]))
  }, [])
  // Lo recordado de la tanda anterior, salvo que se haya soltado dentro de un álbum.
  useEffect(() => {
    if (albumActual) {
      const a = albumes.find((x) => x.id === albumActual.id)
      setAlbum(a ?? { id: albumActual.id, nombre: albumActual.nombre, fecha: '', n: 0 })
      return
    }
    try {
      const r = JSON.parse(localStorage.getItem(CLAVE) || 'null') as EleccionSubida | null
      // Solo se rellena la clase pedida en el menú: el recuerdo no la cambia.
      if (r?.semana && semanas.some((s) => s.id === r.semana!.id)) {
        setSemanaId(r.semana.id); setActividad(r.semana.actividad)
      }
      if (r?.albumId && albumes.some((a) => a.id === r.albumId)) {
        setAlbum(albumes.find((a) => a.id === r.albumId) ?? null)
      }
    } catch {
      /* sin recuerdo */
    }
  }, [semanas, albumes, albumActual])
  useEffect(() => {
    if (semanaId === '') return setActividades([])
    api<{ actividades: Actividad[] }>(`/api/semanas/${semanaId}`).then((s) => setActividades(s.actividades)).catch(() => setActividades([]))
  }, [semanaId])
  const n = archivos.length
  const nombreLimpio = nombreNuevo.trim()
  const valida = clase === 'semana' ? semanaId !== '' && actividad !== '' : album !== null || nombreLimpio.length >= 3
  const subir = () => {
    const e: EleccionSubida = clase === 'semana'
      ? { semana: { id: Number(semanaId), actividad }, albumId: null, nuevoAlbum: null }
      : album
        ? { semana: null, albumId: album.id, nuevoAlbum: null }
        : { semana: null, albumId: null, nuevoAlbum: { nombre: nombreLimpio, fecha: fechaNueva } }
    try {
      localStorage.setItem(CLAVE, JSON.stringify(e))
    } catch {
      /* sin almacenamiento */
    }
    alSubir(e)
  }
  return (
    <Dialog open onClose={alCerrar} maxWidth="xs" fullWidth>
      <DialogTitle>Subir {n} {n === 1 ? 'archivo' : 'archivos'}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '8px !important' }}>
        <Typography variant="body2">¿De qué actividad son?</Typography>
        <ToggleButtonGroup exclusive size="small" fullWidth value={clase} onChange={(_, v: Clase | null) => v && setClase(v)}>
          <ToggleButton value="semana" disabled={!semanas.length}>Semana de Representación</ToggleButton>
          <ToggleButton value="otra">Otra actividad</ToggleButton>
        </ToggleButtonGroup>
        {clase === 'semana' && (
          <>
            <TextField select size="small" label="Semana" value={semanaId} onChange={(e) => { setSemanaId(e.target.value === '' ? '' : Number(e.target.value)); setActividad('') }}>
              {semanas.map((s) => <MenuItem key={s.id} value={s.id}>{s.codigo} · {s.tema}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Actividad" value={actividad} onChange={(e) => setActividad(e.target.value)} disabled={semanaId === ''}
              helperText={semanaId !== '' && !actividades.length ? 'Esta semana aún no tiene actividades: regístrelas en la semana y vuelva.' : undefined}>
              {actividades.map((a) => <MenuItem key={a.codigo} value={a.codigo}>{a.codigo} · {String(a.datos.titulo ?? '')}</MenuItem>)}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              Entran a la Mediateca en el álbum de esa actividad y, además, al banco de trabajo de la semana.
            </Typography>
          </>
        )}
        {clase === 'otra' && (
          <>
            <Autocomplete
              size="small"
              options={albumes}
              value={album}
              onChange={(_, v) => { setAlbum(v); if (v) setNombreNuevo('') }}
              getOptionLabel={(a) => a.nombre}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderOption={(props, a) => <li {...props} key={a.id}>{a.nombre}{a.fecha ? ` · ${a.fecha}` : ''}{a.n ? ` · ${a.n}` : ''}</li>}
              renderInput={(params) => <TextField {...params} label="Actividad ya registrada" placeholder="Buscar…" />}
              noOptionsText="No hay actividades con ese nombre: escríbala abajo como nueva"
            />
            {!album && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 1 }}>
                <TextField size="small" label="Actividad nueva" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="p. ej. Sesión de la Comisión de Educación" autoFocus />
                <TextField size="small" label="Fecha" type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} InputLabelProps={{ shrink: true }} />
              </Box>
            )}
            <Typography variant="caption" color="text.secondary">
              Cada actividad es un álbum de la Mediateca; sus fotos y videos se ven juntos.
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={subir} disabled={!valida}>Subir</Button>
      </DialogActions>
    </Dialog>
  )
}
