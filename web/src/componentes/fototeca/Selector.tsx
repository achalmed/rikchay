/**
 * SELECTOR de la Fototeca para los otros módulos («Elegir de la Fototeca» del
 * proyecto, «Agregar desde la Fototeca» de la semana): la misma cuadrícula, con
 * buscador, álbum y estado, y un clic marca. No muestra la papelera.
 */
import { useCallback, useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import InputAdornment from '@mui/material/InputAdornment'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import { api, EstadoVacio } from '@qillqa/tiqsi'
import Cuadricula from './Cuadricula'
import { ESTADOS, type Album, type Foto, type Pagina } from './modelo'

interface Props {
  abierto: boolean
  titulo?: string
  /** Una sola foto (el proyecto) o varias (la semana). */
  multiple?: boolean
  /** Texto del botón de confirmar. */
  accion?: string
  alCerrar: () => void
  alElegir: (fotos: Foto[]) => void | Promise<void>
}

export default function Selector({ abierto, titulo = 'Elegir de la Mediateca', multiple = false, accion = 'Elegir', alCerrar, alElegir }: Props) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const [q, setQ] = useState('')
  const [buscar, setBuscar] = useState('')
  const [album, setAlbum] = useState('')
  const [estado, setEstado] = useState('')
  const [albumes, setAlbumes] = useState<Album[]>([])
  const [fotos, setFotos] = useState<Foto[]>([])
  const [siguiente, setSiguiente] = useState<number | null>(0)
  const [cargando, setCargando] = useState(false)
  const [elegidas, setElegidas] = useState<Set<number>>(new Set())
  const [enviando, setEnviando] = useState(false)

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setBuscar(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const cargar = useCallback(async (desde: number, reemplazar: boolean) => {
    setCargando(true)
    try {
      const p = new URLSearchParams({ q: buscar, album, estado, limite: '90', desde_n: String(desde), medio: 'foto' })
      const r = await api<Pagina>(`/api/fototeca?${p}`)
      setFotos((antes) => (reemplazar ? r.fotos : [...antes, ...r.fotos]))
      setSiguiente(r.siguiente)
    } finally {
      setCargando(false)
    }
  }, [buscar, album, estado])

  useEffect(() => {
    if (!abierto) return
    void cargar(0, true)
  }, [abierto, cargar])
  useEffect(() => {
    if (!abierto) return
    setElegidas(new Set())
    api<Album[]>('/api/fototeca/albumes').then(setAlbumes).catch(() => {})
  }, [abierto])

  const marcar = (id: number) => {
    setElegidas((antes) => {
      if (!multiple) return new Set(antes.has(id) ? [] : [id])
      const s = new Set(antes)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }
  async function confirmar() {
    setEnviando(true)
    try {
      await alElegir(fotos.filter((f) => elegidas.has(f.id)))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={alCerrar} fullScreen={celular} maxWidth="lg" fullWidth PaperProps={{ sx: { height: celular ? '100%' : '86vh' } }}>
      <DialogTitle sx={{ pb: 1 }}>{titulo}</DialogTitle>
      <Box sx={{ display: 'flex', gap: 1, px: 3, pb: 1, flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="Buscar por título, pie, lugar, etiqueta o persona" value={q} onChange={(e) => setQ(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        <TextField size="small" select label="Álbum" value={album} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }} onChange={(e) => setAlbum(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Todos</MenuItem>
          {albumes.map((a) => <MenuItem key={a.id} value={String(a.id)}>{a.nombre}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Estado" value={estado} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }} onChange={(e) => setEstado(e.target.value)} sx={{ minWidth: 130 }}>
          <MenuItem value="">Todos</MenuItem>
          {ESTADOS.map((e) => <MenuItem key={e.valor} value={e.valor}>{e.etiqueta}</MenuItem>)}
        </TextField>
      </Box>
      <DialogContent dividers sx={{ p: 1.5 }}>
        {!cargando && fotos.length === 0 ? (
          <EstadoVacio titulo="No hay fotos con esos filtros" texto="Suba fotos en la Mediateca o cambie la búsqueda." />
        ) : (
          <Cuadricula fotos={fotos} alto={150} seleccion={elegidas} alMarcar={(id) => marcar(id)} alAbrir={(i) => marcar(fotos[i].id)}
            hayMas={siguiente !== null} cargando={cargando} alPedirMas={() => siguiente !== null && !cargando && void cargar(siguiente, false)}
            soloMarcar sinDias />
        )}
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
          {elegidas.size ? `${elegidas.size} elegida${elegidas.size === 1 ? '' : 's'}` : multiple ? 'Toque las fotos que quiera agregar' : 'Toque una foto'}
        </Typography>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" disabled={!elegidas.size || enviando} onClick={() => void confirmar()}>
          {enviando ? 'Agregando…' : accion}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
