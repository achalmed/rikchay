/**
 * FOTOTECA — las fotografías originales de la entidad, en un solo lugar (Edison
 * 2026-10-06: «subir fotografías originales y gestionarlas desde el propio
 * sistema: administración, organización, edición […] para la Semana de
 * Representación, estados, publicaciones, informes»; «similar a DigiKam o mejor
 * adaptada a las necesidades de la entidad»).
 *
 *   ┌ panel: Todas · Por revisar · Favoritas · Álbumes · Etiquetas · Personas ·
 *   │        Usadas en · Línea de tiempo · Papelera
 *   ├ barra: buscar · orden · tamaño · Subir
 *   └ cuadrícula justificada por día (desplazamiento infinito), selección
 *     múltiple con barra de acciones en lote, visor y editor.
 *
 * Los filtros viven en la dirección (?ver=, ?album=, ?etiqueta=, ?persona=,
 * ?mes=, ?vinculo=): se puede volver a una vista, compartirla o llegar a ella
 * desde la semana. Subir: botón o arrastrar fotos sobre la página, sin preguntar nada (la fecha
 * la pone el archivo); si se está dentro de un álbum, entran en él. El menú junto a «Subir» las
 * deja de una vez en una Semana de Representación o en otra actividad. El original nunca se modifica
 * (backend/app/servicios/fototeca.py).
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Menu from '@mui/material/Menu'
import InputAdornment from '@mui/material/InputAdornment'
import Typography from '@mui/material/Typography'
import Slider from '@mui/material/Slider'
import Tooltip from '@mui/material/Tooltip'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Collapse from '@mui/material/Collapse'
import Chip from '@mui/material/Chip'
import Drawer from '@mui/material/Drawer'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Autocomplete from '@mui/material/Autocomplete'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Paper from '@mui/material/Paper'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import UploadIcon from '@mui/icons-material/Upload'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import StarIcon from '@mui/icons-material/Star'
import CollectionsOutlinedIcon from '@mui/icons-material/CollectionsOutlined'
import FolderOffOutlinedIcon from '@mui/icons-material/FolderOffOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined'
import AddIcon from '@mui/icons-material/Add'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import FilterListIcon from '@mui/icons-material/FilterList'
import CloseIcon from '@mui/icons-material/Close'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LinkIcon from '@mui/icons-material/Link'
import BrandingWatermarkOutlinedIcon from '@mui/icons-material/BrandingWatermarkOutlined'
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import { api, confirmar, EstadoVacio, Marco, PALETA, rol } from '@qillqa/tiqsi'
import Cuadricula, { AGRUPACIONES, type Agrupar } from '../componentes/fototeca/Cuadricula'
import DialogoSubir, { type Clase as ClaseSubida, type EleccionSubida } from '../componentes/fototeca/DialogoSubir'
import { carpetaLocal, elegirCarpetaLocal, guardarLocal, idsLocales, olvidarCarpetaLocal, permisoLocal, soportaCopiaLocal } from '../componentes/fototeca/copiaLocal'
import LaptopOutlinedIcon from '@mui/icons-material/LaptopOutlined'
import Visor from '../componentes/fototeca/Visor'
import Editor from '../componentes/fototeca/Editor'
import {
  type Lugar, ACEPTA, CATEGORIAS_MARCA, COLORES, FORMATOS_PRENSA, ESTADOS, ORDENES, PRESETS, SELECCIONES, esVideo, hexColor, seleccionDeTecla, type Album, type Facetas, type Foto, type Pagina, bajar, exportar, nombreMes, subirFotos, type AvanceSubida,
} from '../componentes/fototeca/modelo'
import Depuracion, { IconoSeleccion } from '../componentes/fototeca/Depuracion'
import { AvatarCara, urlRecorte } from '../componentes/fototeca/Caras'
import Popover from '@mui/material/Popover'
import Badge from '@mui/material/Badge'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import Filtros, { CLAVES_FILTRO, FiltrosActivos } from '../componentes/fototeca/Filtros'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ButtonGroup from '@mui/material/ButtonGroup'
import CircularProgress from '@mui/material/CircularProgress'
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
// El mapa (Leaflet) se baja solo al abrirlo.
const Mapa = lazy(() => import('../componentes/fototeca/Mapa'))
import Parecidas from '../componentes/fototeca/Parecidas'
import FilterNoneOutlinedIcon from '@mui/icons-material/FilterNoneOutlined'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'

type Avisar = (tipo: 'success' | 'error' | 'info', t: string) => void
const PAGINA = 120
const CLAVE_TAMANO = 'qillqa_fototeca_tamano'

function leerTamano(): number {
  try {
    return Number(localStorage.getItem(CLAVE_TAMANO)) || 180
  } catch {
    return 180
  }
}

/** Los filtros de la dirección, como consulta para la API. */
function consultaApi(p: URLSearchParams, q: string, orden: string): URLSearchParams {
  const c = new URLSearchParams({ orden })
  const ver = p.get('ver')
  if (q) c.set('q', q)
  if (ver === 'revisar') c.set('estado', 'por_revisar')
  if (ver === 'favoritas') c.set('favorita', 'true')
  if (ver === 'papelera') c.set('papelera', 'true')
  if (ver === 'sin-album') c.set('album', 'ninguno')
  for (const k of ['album', 'mes', 'vinculo', 'estado', ...CLAVES_FILTRO]) {
    const v = p.get(k)
    if (v) c.set(k, v)
  }
  // La marca (2026-10-19): logotipos, retratos, recursos, marcos y color, aparte de las fotos de actividades.
  const marca = p.get('marca')
  if (marca) {
    c.set('ambito', 'marca')
    if (marca !== 'todo') c.set('categoria', marca)
  }
  // Lo que produce Prensa (2026-10-20): posts, historias, portadas y videos, aparte también.
  const prensa = p.get('prensa')
  if (prensa) {
    c.set('ambito', 'prensa')
    if (prensa !== 'todo') c.set('categoria', prensa)
  }
  return c
}

// --- Panel lateral ----------------------------------------------------------------------------

function Panel({ f, p, ir, alNuevoAlbum, retratos }: {
  f: Facetas | null
  /** El recorte por cara de cada persona con cara marcada (su retrato). */
  retratos: Map<string, string>
  p: URLSearchParams
  ir: (cambios: Record<string, string | null>) => void
  alNuevoAlbum: () => void
}) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const [masEtiquetas, setMasEtiquetas] = useState(false)
  const anios = useMemo(() => {
    const g = new Map<string, { mes: string; n: number }[]>()
    for (const m of f?.meses ?? []) g.set(m.mes.slice(0, 4), [...(g.get(m.mes.slice(0, 4)) ?? []), m])
    return [...g.entries()]
  }, [f])
  const ver = p.get('ver') ?? ''
  const sinFiltro = !ver && !['album', 'mes', 'vinculo', 'marca', 'prensa', ...CLAVES_FILTRO].some((k) => p.get(k))
  // Las vistas del panel se reemplazan entre sí; los filtros (Filtros.tsx) se conservan. «Todas» quita todo.
  const LIMPIO = { ver: null, album: null, etiqueta: null, persona: null, mes: null, vinculo: null, marca: null, prensa: null }
  const TODO = { ...LIMPIO, ...Object.fromEntries(CLAVES_FILTRO.map((k) => [k, null])) }
  const marca = new Map((f?.marca ?? []).map((m) => [m.categoria, m.n]))
  const totalMarca = [...marca.values()].reduce((s, n) => s + n, 0)
  const prensa = new Map((f?.prensa ?? []).map((m) => [m.categoria, m.n]))
  const totalPrensa = [...prensa.values()].reduce((s, n) => s + n, 0)
  const item = (activo: boolean, icono: React.ReactNode, texto: string, n: number | undefined, alPulsar: () => void, clave: string | number = texto) => (
    <ListItemButton key={clave} selected={activo} onClick={alPulsar} sx={{ py: 0.5, borderRadius: 1, mx: 0.5 }}>
      <ListItemIcon sx={{ minWidth: 34, color: activo ? 'primary.main' : undefined }}>{icono}</ListItemIcon>
      <ListItemText primary={texto} primaryTypographyProps={{ fontSize: 13.5, noWrap: true, fontWeight: activo ? 650 : 400 }} />
      {n !== undefined && <Typography variant="caption" color="text.secondary">{n}</Typography>}
    </ListItemButton>
  )
  const titulo = (t: string, accion?: React.ReactNode) => (
    <ListSubheader sx={{ lineHeight: '30px', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.6, display: 'flex', alignItems: 'center', bgcolor: 'transparent', position: 'static' }}>
      <Box sx={{ flex: 1 }}>{t}</Box>
      {accion}
    </ListSubheader>
  )
  const semanas = (f?.vinculos ?? []).filter((v) => v.tipo === 'semana')
  const etiquetas = f?.etiquetas ?? []

  return (
    <Box sx={{ py: 1 }}>
      <List dense disablePadding>
        {item(sinFiltro, <PhotoLibraryOutlinedIcon fontSize="small" />, 'Todas', f?.total, () => ir(TODO))}
        {item(ver === 'revisar', <RateReviewOutlinedIcon fontSize="small" />, 'Por revisar', f?.por_revisar, () => ir({ ...LIMPIO, ver: 'revisar' }))}
        {item(ver === 'favoritas', <StarBorderIcon fontSize="small" />, 'Favoritas', f?.favoritas, () => ir({ ...LIMPIO, ver: 'favoritas' }))}
        {item(ver === 'sin-album', <FolderOffOutlinedIcon fontSize="small" />, 'Sin álbum', f?.sin_album, () => ir({ ...LIMPIO, ver: 'sin-album' }))}
        {item(ver === 'parecidas', <FilterNoneOutlinedIcon fontSize="small" />, 'Parecidas', undefined, () => ir({ ...LIMPIO, ver: 'parecidas' }))}
      </List>
      {/* Depuración (2026-10-19): se suma a la vista elegida (un álbum, un mes…), como el filtro de digiKam. */}
      <List dense disablePadding subheader={titulo('Selección')}>
        {SELECCIONES.map((s) => item(p.get('seleccion') === s.valor, <IconoSeleccion valor={s.valor} fontSize="small" sx={{ color: s.color }} />, s.plural,
          f?.seleccion?.[s.valor] ?? 0, () => ir({ seleccion: p.get('seleccion') === s.valor ? null : s.valor }), `sel-${s.valor}`))}
        {item(p.get('seleccion') === 'ninguna', <Box component="span" sx={{ width: 20 }} />, 'Sin marcar', f?.seleccion?.ninguna ?? 0,
          () => ir({ seleccion: p.get('seleccion') === 'ninguna' ? null : 'ninguna' }), 'sel-ninguna')}
      </List>
      {(f?.colores?.length ?? 0) > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, px: 2, pb: 1, pt: 0.5 }}>
          {f!.colores!.map((c) => {
            const activo = p.get('color') === c.color
            return (
              <Tooltip key={c.color} title={`${COLORES.find((x) => x.valor === c.color)?.etiqueta ?? c.color} · ${c.n}`}>
                <Box component="button" type="button" aria-pressed={activo} aria-label={`Color ${c.color}`} onClick={() => ir({ color: activo ? null : c.color })}
                  sx={{ width: 20, height: 20, p: 0, border: 0, cursor: 'pointer', borderRadius: '50%', bgcolor: hexColor(c.color),
                    boxShadow: activo ? `0 0 0 2px ${PALETA.superficie}, 0 0 0 4px ${hexColor(c.color)}` : 'inset 0 0 0 1px rgba(0,0,0,.18)' }} />
              </Tooltip>
            )
          })}
        </Box>
      )}
      <List dense disablePadding subheader={titulo('Álbumes', (
        <Tooltip title="Nuevo álbum"><IconButton size="small" onClick={alNuevoAlbum}><AddIcon fontSize="small" /></IconButton></Tooltip>
      ))}>
        {(f?.albumes ?? []).map((a) => item(p.get('album') === String(a.id), <CollectionsOutlinedIcon fontSize="small" />, a.nombre, a.n, () => ir({ ...LIMPIO, album: String(a.id) }), a.id))}
        {f && f.albumes.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>Aún no hay álbumes.</Typography>}
      </List>
      {etiquetas.length > 0 && (
        <Box>
          {titulo('Etiquetas')}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1.5 }}>
            {(masEtiquetas ? etiquetas : etiquetas.slice(0, 14)).map((e) => (
              <Chip key={e.valor} size="small" label={`${e.valor} · ${e.n}`} color={p.get('etiqueta') === e.valor ? 'primary' : 'default'}
                variant={p.get('etiqueta') === e.valor ? 'filled' : 'outlined'}
                onClick={() => ir({ ...LIMPIO, etiqueta: p.get('etiqueta') === e.valor ? null : e.valor })} />
            ))}
            {etiquetas.length > 14 && (
              <Button size="small" onClick={() => setMasEtiquetas(!masEtiquetas)}>{masEtiquetas ? 'Menos' : `Todas (${etiquetas.length})`}</Button>
            )}
          </Box>
        </Box>
      )}
      {(f?.personas.length ?? 0) > 0 && (
        <Box>
          {titulo('Personas')}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1.5 }}>
            {f!.personas.slice(0, 30).map((e) => (
              <Chip key={e.valor} size="small" avatar={retratos.get(e.valor.toLowerCase()) ? <AvatarCara ruta={retratos.get(e.valor.toLowerCase())!} nombre={e.valor} tam={20} /> : undefined} label={`${e.valor} · ${e.n}`} color={p.get('persona') === e.valor ? 'primary' : 'default'}
                variant={p.get('persona') === e.valor ? 'filled' : 'outlined'}
                onClick={() => ir({ ...LIMPIO, persona: p.get('persona') === e.valor ? null : e.valor })} />
            ))}
          </Box>
        </Box>
      )}
      {totalMarca > 0 && (
        <List dense disablePadding subheader={titulo('Marca')}>
          {item(p.get('marca') === 'todo', <BrandingWatermarkOutlinedIcon fontSize="small" />, 'Toda la marca', totalMarca, () => ir({ ...LIMPIO, marca: 'todo' }), 'marca-todo')}
          {CATEGORIAS_MARCA.filter((c) => marca.get(c.clave)).map((c) => item(p.get('marca') === c.clave, <Box component="span" sx={{ width: 20 }} />, c.etiqueta, marca.get(c.clave), () => ir({ ...LIMPIO, marca: c.clave }), `marca-${c.clave}`))}
        </List>
      )}
      {totalPrensa > 0 && (
        <List dense disablePadding subheader={titulo('Prensa')}>
          {item(p.get('prensa') === 'todo', <CampaignOutlinedIcon fontSize="small" />, 'Todo lo de Prensa', totalPrensa, () => ir({ ...LIMPIO, prensa: 'todo' }), 'prensa-todo')}
          {FORMATOS_PRENSA.filter((c) => prensa.get(c.clave)).map((c) => item(p.get('prensa') === c.clave, <Box component="span" sx={{ width: 20 }} />, c.etiqueta, prensa.get(c.clave), () => ir({ ...LIMPIO, prensa: c.clave }), `prensa-${c.clave}`))}
        </List>
      )}
      {semanas.length > 0 && (
        <List dense disablePadding subheader={titulo('Semanas de representación')}>
          {semanas.map((v) => item(p.get('vinculo') === `semana:${v.id}`, <LinkIcon fontSize="small" />, v.etiqueta, v.n, () => ir({ ...LIMPIO, vinculo: `semana:${v.id}` }), v.id))}
        </List>
      )}
      {anios.length > 0 && (
        <List dense disablePadding subheader={titulo('Línea de tiempo')}>
          {anios.map(([anio, meses]) => {
            const abierto = abiertos[anio] ?? (anio === anios[0][0] || meses.some((m) => m.mes === p.get('mes')))
            return (
              <Box key={anio}>
                <ListItemButton onClick={() => setAbiertos({ ...abiertos, [anio]: !abierto })} sx={{ py: 0.25, mx: 0.5, borderRadius: 1 }}>
                  <ListItemText primary={anio} primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>{meses.reduce((s, m) => s + m.n, 0)}</Typography>
                  {abierto ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </ListItemButton>
                <Collapse in={abierto}>
                  {meses.map((m) => (
                    <ListItemButton key={m.mes} selected={p.get('mes') === m.mes} onClick={() => ir({ ...LIMPIO, mes: m.mes })} sx={{ py: 0.25, pl: 4, mx: 0.5, borderRadius: 1 }}>
                      <ListItemText primary={nombreMes(m.mes).replace(/ de \d{4}$/, '')} primaryTypographyProps={{ fontSize: 13, sx: { '&::first-letter': { textTransform: 'uppercase' } } }} />
                      <Typography variant="caption" color="text.secondary">{m.n}</Typography>
                    </ListItemButton>
                  ))}
                </Collapse>
              </Box>
            )
          })}
        </List>
      )}
      <List dense disablePadding sx={{ mt: 1 }}>
        {item(ver === 'papelera', <DeleteOutlineIcon fontSize="small" />, 'Papelera', f?.papelera, () => ir({ ...LIMPIO, ver: 'papelera' }))}
      </List>
    </Box>
  )
}

// --- Diálogos -------------------------------------------------------------------------------

function DialogoAlbum({ album, alCerrar, alGuardar }: { album: Partial<Album> | null; alCerrar: () => void; alGuardar: (a: Partial<Album>) => Promise<void> }) {
  const [d, setD] = useState<Partial<Album>>({})
  useEffect(() => setD(album ?? {}), [album])
  return (
    <Dialog open={album !== null} onClose={alCerrar} fullWidth maxWidth="xs">
      <DialogTitle>{album?.id ? 'Álbum' : 'Nuevo álbum'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField label="Nombre" autoFocus value={d.nombre ?? ''} onChange={(e) => setD({ ...d, nombre: e.target.value })} placeholder="Sesión del Pleno, visita a Huanta…" />
        <TextField label="Fecha del evento" type="date" InputLabelProps={{ shrink: true }} value={d.fecha ?? ''} onChange={(e) => setD({ ...d, fecha: e.target.value })} />
        <TextField label="Descripción" multiline minRows={2} value={d.descripcion ?? ''} onChange={(e) => setD({ ...d, descripcion: e.target.value })} />
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" disabled={!d.nombre?.trim()} onClick={() => void alGuardar(d)}>Guardar</Button>
      </DialogActions>
    </Dialog>
  )
}

function DialogoEtiquetar({ abierto, n, etiquetas, personas, alCerrar, alAplicar }: {
  abierto: boolean
  n: number
  etiquetas: string[]
  personas: string[]
  alCerrar: () => void
  alAplicar: (c: { etiquetas_agregar: string[]; etiquetas_quitar: string[]; personas_agregar: string[]; lugar?: string }) => Promise<void>
}) {
  const [agregar, setAgregar] = useState<string[]>([])
  const [quitar, setQuitar] = useState<string[]>([])
  const [gente, setGente] = useState<string[]>([])
  const [lugar, setLugar] = useState('')
  useEffect(() => {
    if (abierto) {
      setAgregar([])
      setQuitar([])
      setGente([])
      setLugar('')
    }
  }, [abierto])
  const campo = (etiqueta: string, valor: string[], cambiar: (v: string[]) => void, opciones: string[], libre = true) => (
    <Autocomplete multiple freeSolo={libre} size="small" options={opciones} value={valor} onChange={(_, v) => cambiar(v as string[])}
      renderInput={(p) => <TextField {...p} label={etiqueta} placeholder="Escriba y pulse Enter" />} />
  )
  return (
    <Dialog open={abierto} onClose={alCerrar} fullWidth maxWidth="sm">
      <DialogTitle>Etiquetar {n} foto{n === 1 ? '' : 's'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {campo('Agregar etiquetas', agregar, setAgregar, etiquetas)}
        {campo('Quitar etiquetas', quitar, setQuitar, etiquetas, false)}
        {campo('Agregar personas', gente, setGente, personas)}
        <TextField size="small" label="Lugar (vacío = no cambiar)" value={lugar} onChange={(e) => setLugar(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" disabled={!agregar.length && !quitar.length && !gente.length && !lugar.trim()}
          onClick={() => void alAplicar({ etiquetas_agregar: agregar, etiquetas_quitar: quitar, personas_agregar: gente, ...(lugar.trim() ? { lugar: lugar.trim() } : {}) })}>
          Aplicar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// --- Página ---------------------------------------------------------------------------------

export default function Fototeca() {
  const tema = useTheme()
  const angosta = useMediaQuery(tema.breakpoints.down('md'))
  const [p, setP] = useSearchParams()
  const [q, setQ] = useState('')
  const [buscar, setBuscar] = useState('')
  const [orden, setOrden] = useState('reciente')
  const [tamano, setTamano] = useState(leerTamano)
  const [fotos, setFotos] = useState<Foto[]>([])
  const [total, setTotal] = useState(0)
  const [siguiente, setSiguiente] = useState<number | null>(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [facetas, setFacetas] = useState<Facetas | null>(null)
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [abierta, setAbierta] = useState<number | null>(null)
  const [editando, setEditando] = useState<Foto | null>(null)
  const [panel, setPanel] = useState(false)
  const [subida, setSubida] = useState<AvanceSubida | null>(null)
  // Cerrar o recargar la pestaña corta la subida: el navegador pregunta antes.
  const subiendo = subida !== null
  useEffect(() => {
    if (!subiendo) return
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', antes)
    return () => window.removeEventListener('beforeunload', antes)
  }, [subiendo])
  const [arrastrando, setArrastrando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'success' | 'error' | 'info'; texto: string } | null>(null)
  const [album, setAlbum] = useState<Partial<Album> | null>(null)
  const [etiquetar, setEtiquetar] = useState(false)
  const [menu, setMenu] = useState<{ cual: 'album' | 'estado' | 'descargar'; ancla: HTMLElement } | null>(null)
  const [depurar, setDepurar] = useState<HTMLElement | null>(null)
  const [filtrando, setFiltrando] = useState(false)
  // Agrupación de la cuadrícula (2026-10-10): día, mes, actividad, álbum, etiqueta.
  // Por omisión, por actividad (álbum): en la Mediateca no hay fotos sueltas (2026-10-10).
  const [agrupar, setAgrupar] = useState<Agrupar>(() => (localStorage.getItem('qillqa-mediateca-agrupar') as Agrupar) || 'album')
  useEffect(() => { try { localStorage.setItem('qillqa-mediateca-agrupar', agrupar) } catch { /* nada */ } }, [agrupar])
  // Copia local en este equipo (Año/Mes en la carpeta elegida); null = sin carpeta elegida.
  const [carpeta, setCarpeta] = useState<FileSystemDirectoryHandle | null>(null)
  const [locales, setLocales] = useState<Set<number> | null>(null)
  const [copiando, setCopiando] = useState<{ hecho: number; total: number } | null>(null)
  const [menuLocal, setMenuLocal] = useState<HTMLElement | null>(null)
  // «Subir» sube sin preguntar (2026-10-20); solo si se eligió en su menú una Semana de
  // Representación u otra actividad, los archivos esperan en el diálogo a que se diga cuál.
  const [porSubir, setPorSubir] = useState<File[] | null>(null)
  const [menuSubir, setMenuSubir] = useState<HTMLElement | null>(null)
  const claseSubida = useRef<ClaseSubida | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const ultimo = useRef<number | null>(null)
  const pedido = useRef(0)
  const soloLectura = rol() === 'invitado'
  const avisar: Avisar = useCallback((tipo, texto) => setAviso({ tipo, texto }), [])

  useEffect(() => {
    if (!soportaCopiaLocal()) return
    carpetaLocal().then(async (dir) => {
      if (!dir) return
      setCarpeta(dir)
      try {
        setLocales(await idsLocales(dir))
      } catch {
        setLocales(new Set())
      }
    }).catch(() => undefined)
  }, [])
  const refrescarLocales = async (dir: FileSystemDirectoryHandle) => setLocales(await idsLocales(dir))
  const elegirLocal = async () => {
    setMenuLocal(null)
    const dir = await elegirCarpetaLocal()
    if (!dir) return
    setCarpeta(dir)
    await refrescarLocales(dir)
    avisar('success', `Las fotos se guardarán en «${dir.name}», por año y mes.`)
  }
  const copiarLocal = async (cuales: Foto[]) => {
    setMenuLocal(null)
    if (!carpeta || !(await permisoLocal(carpeta))) return
    setCopiando({ hecho: 0, total: cuales.length })
    try {
      const r = await guardarLocal(carpeta, cuales, (hecho, total) => setCopiando({ hecho, total }))
      await refrescarLocales(carpeta)
      avisar(r.errores ? 'error' : 'success', `${r.guardadas} guardada${r.guardadas === 1 ? '' : 's'} en «${carpeta.name}»${r.yaEstaban ? ` · ${r.yaEstaban} ya estaban` : ''}${r.errores ? ` · ${r.errores} con error` : ''}.`)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo guardar la copia local.')
    } finally {
      setCopiando(null)
    }
  }

  const enPapelera = p.get('ver') === 'papelera'
  const enParecidas = p.get('ver') === 'parecidas'
  const enMapa = p.get('vista') === 'mapa' && !enParecidas
  // Se suma cuando el visor guarda algo: la vista de parecidas se vuelve a pedir.
  const [vuelta, setVuelta] = useState(0)
  const albumActual = facetas?.albumes.find((a) => String(a.id) === p.get('album')) ?? null
  const consulta = useMemo(() => consultaApi(p, buscar, orden).toString(), [p, buscar, orden])

  useEffect(() => {
    const t = setTimeout(() => setBuscar(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_TAMANO, String(tamano))
    } catch {
      /* sin almacenamiento: el tamaño no se recuerda */
    }
  }, [tamano])

  const cargar = useCallback(async (desde: number) => {
    const id = ++pedido.current
    setCargando(true)
    try {
      const r = await api<Pagina>(`/api/fototeca?${consulta}&limite=${PAGINA}&desde_n=${desde}`)
      if (id !== pedido.current) return // llegó tarde: ya se pidió otra vista
      setFotos((antes) => (desde === 0 ? r.fotos : [...antes, ...r.fotos]))
      setTotal(r.total)
      setSiguiente(r.siguiente)
      setError('')
    } catch (e) {
      if (id === pedido.current) setError(e instanceof Error ? e.message : 'No se pudo leer la Mediateca.')
    } finally {
      if (id === pedido.current) setCargando(false)
    }
  }, [consulta])
  const [retratos, setRetratos] = useState<Map<string, string>>(new Map())
  const [lugares, setLugares] = useState<Lugar[]>([])
  // Las fotos de un punto del mapa o de un grupo de parecidas, para el visor (no son las de la cuadrícula).
  const [fotosAparte, setFotosAparte] = useState<Foto[] | null>(null)
  const recargarFacetas = useCallback(() => {
    api<Lugar[]>('/api/fototeca/lugares').then(setLugares).catch(() => {})
    api<Facetas>('/api/fototeca/facetas').then(setFacetas).catch(() => {})
    api<{ nombre: string; cara_id: number | null }[]>('/api/fototeca/personas')
      .then((l) => setRetratos(new Map(l.filter((x) => x.cara_id).map((x) => [x.nombre.toLowerCase(), urlRecorte({ id: x.cara_id!, x: 0, y: 0, ancho: 0, alto: 0 }, 64)]))))
      .catch(() => {})
  }, [])
  const recargar = useCallback(() => {
    void cargar(0)
    recargarFacetas()
  }, [cargar, recargarFacetas])

  useEffect(() => {
    setSeleccion(new Set())
    ultimo.current = null
    void cargar(0)
  }, [cargar])
  useEffect(recargarFacetas, [recargarFacetas])

  // Ctrl+A marca todo lo cargado; Esc suelta la selección (sin diálogos abiertos).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (abierta !== null || editando || etiquetar || album) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSeleccion(new Set(fotos.map((f) => f.id)))
      }
      if (e.key === 'Escape') setSeleccion(new Set())
      const sel = soloLectura || !seleccion.size ? null : seleccionDeTecla(e)
      if (sel !== null) {
        e.preventDefault()
        void loteRef.current?.({ seleccion: sel }, sel ? `{n} foto(s): ${SELECCIONES.find((x) => x.valor === sel)?.etiqueta.toLowerCase()}.` : '{n} foto(s) sin marca.')
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [fotos, abierta, editando, etiquetar, album, seleccion, soloLectura])

  const ir = (cambios: Record<string, string | null>) => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) n.delete(k)
      else n.set(k, v)
    }
    setP(n)
    setPanel(false)
  }

  const marcar = (id: number, indice: number, tramo: boolean) => {
    setSeleccion((antes) => {
      const s = new Set(antes)
      if (tramo && ultimo.current !== null) {
        const [a, b] = [Math.min(ultimo.current, indice), Math.max(ultimo.current, indice)]
        for (let i = a; i <= b; i++) if (fotos[i]) s.add(fotos[i].id)
      } else if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
    ultimo.current = indice
  }

  const reemplazar = (f: Foto) => {
    setFotos((antes) => antes.map((x) => (x.id === f.id ? { ...x, ...f } : x)))
    setFotosAparte((antes) => antes && antes.map((x) => (x.id === f.id ? { ...x, ...f } : x)))
  }

  function subir(lista: FileList | File[] | null) {
    const archivos = Array.from(lista ?? []).filter(
      (a) => a.type.startsWith('image/') || a.type.startsWith('video/') || /\.(heic|heif|tiff?|mp4|m4v|mov|webm)$/i.test(a.name),
    )
    if (!archivos.length) return
    if (entrada.current) entrada.current.value = ''
    if (claseSubida.current) return setPorSubir(archivos)
    // Sin preguntar nada: la fecha la pone cada archivo; dentro de un álbum, entran en él.
    void subirDeVerdad(archivos, { semana: null, albumId: albumActual?.id ?? null, nuevoAlbum: null })
  }

  function elegirArchivos(clase: ClaseSubida | null) {
    setMenuSubir(null)
    claseSubida.current = clase
    entrada.current?.click()
  }

  async function subirDeVerdad(archivos: File[], eleccion: EleccionSubida) {
    setPorSubir(null)
    setSubida({ fase: 'revisando', listos: 0, archivos: archivos.length, enviado: 0, total: 0, yaEstaban: 0, fallaron: 0 })
    try {
      // Sin actividad, entran sueltas y se ordenan por su fecha (2026-10-20); con ella, a un álbum
      // existente, a uno nuevo que se crea aquí o a la actividad de una semana (su álbum lo pone el servidor).
      let albumId = eleccion.albumId
      if (eleccion.nuevoAlbum) {
        const a = await api<Album>('/api/fototeca/albumes', { method: 'POST', body: JSON.stringify({ nombre: eleccion.nuevoAlbum.nombre, fecha: eleccion.nuevoAlbum.fecha }) })
        albumId = a.id
      }
      const r = await subirFotos(archivos, albumId, setSubida, eleccion.semana)
      // Lo subido desde este equipo también queda en su copia local (Año/Mes), sin volver a bajarlo.
      if (carpeta && r.nuevas.length) {
        const porNombre = new Map(archivos.map((a) => [a.name, a as Blob]))
        const enMano = new Map<number, Blob>()
        for (const f of r.nuevas) { const b = porNombre.get(f.nombre_original); if (b) enMano.set(f.id, b) }
        try {
          if (await permisoLocal(carpeta)) {
            await guardarLocal(carpeta, r.nuevas, undefined, enMano)
            await refrescarLocales(carpeta)
          }
        } catch { /* la copia local es un extra: la Mediateca ya las tiene */ }
      }
      const videos = r.nuevas.filter(esVideo).length
      const fotosN = r.nuevas.length - videos
      const nuevas = [
        fotosN || !videos ? `${fotosN} foto${fotosN === 1 ? '' : 's'} nueva${fotosN === 1 ? '' : 's'}` : '',
        videos ? `${videos} video${videos === 1 ? '' : 's'} nuevo${videos === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' y ')
      const partes = [`${nuevas}${albumActual && eleccion.albumId === albumActual.id ? ` en «${albumActual.nombre}»` : ''}${r.semana ? ` · ${r.semana.fotos.length} en la semana` : ''}`]
      if (r.duplicadas.length) {
        const enPap = r.duplicadas.filter((d) => d.en_papelera).length
        partes.push(`${r.duplicadas.length} ya estaba${r.duplicadas.length === 1 ? '' : 'n'} en la Mediateca (no se volvieron a subir${enPap ? `; ${enPap} en la papelera` : ''})`)
      }
      if (r.repetidas_en_seleccion) partes.push(`${r.repetidas_en_seleccion} repetida${r.repetidas_en_seleccion === 1 ? '' : 's'} en lo elegido`)
      if (r.rechazadas.length) {
        const ejemplos = r.rechazadas.slice(0, 3).map((x) => `${x.nombre} (${x.motivo})`).join('; ')
        partes.push(`${r.rechazadas.length} no se pudo subir: ${ejemplos}${r.rechazadas.length > 3 ? '…' : ''}. Elíjalas de nuevo: lo ya subido no se repite`)
      }
      avisar(r.rechazadas.length ? 'error' : 'success', partes.join(' · '))
      recargar()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudieron subir las fotos.')
      recargar()
    } finally {
      setSubida(null)
      if (entrada.current) entrada.current.value = ''
    }
  }

  async function lote(cambios: Record<string, unknown>, mensaje: string) {
    const ids = [...seleccion]
    try {
      await api('/api/fototeca/lote', { method: 'PATCH', body: JSON.stringify({ ids, ...cambios }) })
      avisar('success', mensaje.replace('{n}', String(ids.length)))
      setSeleccion(new Set())
      recargar()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo aplicar el cambio.')
    }
  }

  const loteRef = useRef(lote)
  loteRef.current = lote

  async function descargar(preset: string) {
    setMenu(null)
    const ids = [...seleccion]
    avisar('info', `Preparando ${ids.length} foto${ids.length === 1 ? '' : 's'}…`)
    try {
      const { blob, nombre } = await exportar(ids, preset)
      bajar(blob, nombre)
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo exportar.')
    }
  }

  async function papelera(f: Foto, mandar: boolean) {
    try {
      await api(mandar ? `/api/fototeca/${f.id}` : `/api/fototeca/${f.id}/restaurar`, { method: mandar ? 'DELETE' : 'POST' })
      avisar('success', mandar ? 'Foto en la papelera (se puede restaurar).' : 'Foto restaurada.')
      // Sale de la vista actual: el visor pasa a la siguiente.
      const i = fotos.findIndex((x) => x.id === f.id)
      setFotos((antes) => antes.filter((x) => x.id !== f.id))
      setTotal((t) => t - 1)
      if (abierta !== null) setAbierta(fotos.length <= 1 ? null : Math.min(i, fotos.length - 2))
      recargarFacetas()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo.')
    }
  }

  async function guardarAlbum(a: Partial<Album>) {
    try {
      const cuerpo = JSON.stringify({ nombre: a.nombre?.trim(), fecha: a.fecha ?? '', descripcion: a.descripcion ?? '' })
      const r = await api<Album>(a.id ? `/api/fototeca/albumes/${a.id}` : '/api/fototeca/albumes', { method: a.id ? 'PATCH' : 'POST', body: cuerpo })
      setAlbum(null)
      recargarFacetas()
      if (!a.id) {
        if (seleccion.size) await lote({ album_id: r.id }, `{n} foto(s) en «${r.nombre}».`)
        else ir({ ver: null, etiqueta: null, persona: null, mes: null, vinculo: null, album: String(r.id) })
      }
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo guardar el álbum.')
    }
  }

  async function quitarAlbum() {
    if (!albumActual || !(await confirmar(`¿Quitar el álbum «${albumActual.nombre}»? Sus ${albumActual.n} fotos siguen en la Mediateca, sin álbum.`, { aceptar: 'Quitar', peligro: true }))) return
    try {
      await api(`/api/fototeca/albumes/${albumActual.id}`, { method: 'DELETE' })
      ir({ album: null })
      recargarFacetas()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo quitar el álbum.')
    }
  }

  const etiquetasConocidas = (facetas?.etiquetas ?? []).map((e) => e.valor)
  const personasConocidas = (facetas?.personas ?? []).map((e) => e.valor)
  const n = seleccion.size
  // Lo que comparten todas las marcadas (la depuración lo muestra elegido; si difieren, nada).
  const comun = (clave: 'seleccion' | 'color') => {
    const v = new Set(fotos.filter((f) => seleccion.has(f.id)).map((f) => f[clave] ?? ''))
    return v.size === 1 ? [...v][0] : ''
  }
  const todasFavoritas = n > 0 && fotos.filter((f) => seleccion.has(f.id)).every((f) => f.favorita)
  // El título dice la vista del panel; los filtros (Filtros.tsx) se ven como pastillas, no se repiten aquí.
  const tituloVista = (() => {
    const ver = p.get('ver')
    if (ver === 'revisar') return 'Por revisar'
    if (ver === 'favoritas') return 'Favoritas'
    if (ver === 'papelera') return 'Papelera'
    if (ver === 'sin-album') return 'Sin álbum'
    if (ver === 'parecidas') return 'Fotos parecidas'
    if (albumActual) return albumActual.nombre
    if (p.get('mes')) return nombreMes(p.get('mes')!)
    if (p.get('vinculo')) return facetas?.vinculos.find((v) => `${v.tipo}:${v.id}` === p.get('vinculo'))?.etiqueta ?? 'Vinculadas'
    if (p.get('marca')) return CATEGORIAS_MARCA.find((c) => c.clave === p.get('marca'))?.etiqueta ?? 'Toda la marca'
    if (p.get('prensa')) return FORMATOS_PRENSA.find((c) => c.clave === p.get('prensa'))?.etiqueta ?? 'Todo lo de Prensa'
    return 'Todas las fotos'
  })()
  const panelContenido = <Panel f={facetas} p={p} ir={ir} alNuevoAlbum={() => setAlbum({})} retratos={retratos} />

  return (
    <Marco modulo="fototeca" fondo={PALETA.fondo} sinBotonModulo={n > 0 /* la barra de la selección ocupa abajo */}>
      <Box
        sx={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}
        onDragEnter={(e) => { if (!soloLectura && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastrando(true) } }}
        onDragOver={(e) => { if (arrastrando) e.preventDefault() }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastrando(false) }}
        onDrop={(e) => {
          e.preventDefault()
          setArrastrando(false)
          claseSubida.current = null
          if (!soloLectura) void subir(e.dataTransfer.files)
        }}
      >
        {!angosta && (
          <Box component="aside" sx={{ width: 260, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflowY: 'auto', position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: '100dvh' }}>
            {panelContenido}
          </Box>
        )}
        <Drawer open={angosta && panel} onClose={() => setPanel(false)} PaperProps={{ sx: { width: '82vw', maxWidth: 320 } }}>
          {panelContenido}
        </Drawer>

        <Box sx={{ flex: 1, minWidth: 0, px: { xs: 1, sm: 2 }, pb: 10 }}>
          {/* Barra: buscar, ordenar, tamaño y subir. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25, flexWrap: 'wrap' }}>
            {angosta && (
              <IconButton onClick={() => setPanel(true)} aria-label="Álbumes y filtros"><FilterListIcon /></IconButton>
            )}
            <TextField size="small" placeholder="Buscar: título, pie, lugar, etiqueta, persona, archivo" value={q} onChange={(e) => setQ(e.target.value)}
              sx={{ flex: '1 1 220px', bgcolor: 'background.paper' }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                endAdornment: q ? <IconButton size="small" onClick={() => setQ('')} aria-label="Borrar la búsqueda"><CloseIcon fontSize="small" /></IconButton> : null,
              }} />
            <Tooltip describeChild title="Año, selección, color, calificación, etiqueta, persona, lugar, cámara, medio y uso">
              <Button variant="outlined" onClick={() => setFiltrando(true)} sx={{ bgcolor: 'background.paper' }}
                startIcon={<Badge color="primary" variant="dot" invisible={!CLAVES_FILTRO.some((k) => p.get(k))}><FilterAltOutlinedIcon /></Badge>}>
                Filtros
              </Button>
            </Tooltip>
            <TextField size="small" select value={orden} onChange={(e) => setOrden(e.target.value)} sx={{ minWidth: 150, bgcolor: 'background.paper' }} aria-label="Orden">
              {ORDENES.map((o) => <MenuItem key={o.valor} value={o.valor}>{o.etiqueta}</MenuItem>)}
            </TextField>
            {!p.get('marca') && !p.get('prensa') && <TextField size="small" select value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)} sx={{ minWidth: 140, bgcolor: 'background.paper' }} aria-label="Agrupar">
              {AGRUPACIONES.map((a) => <MenuItem key={a.valor} value={a.valor}>{a.etiqueta}</MenuItem>)}
            </TextField>}
            {soportaCopiaLocal() && (
              <>
                <Tooltip title={carpeta ? `Copia en este equipo: «${carpeta.name}» (Año/Mes)` : 'Guardar una copia de las fotos en este equipo, ordenada por año y mes'}>
                  <Button size="small" variant={carpeta ? 'text' : 'outlined'} startIcon={<LaptopOutlinedIcon />} onClick={(e) => setMenuLocal(e.currentTarget)} disabled={copiando !== null}>
                    {copiando ? `Guardando ${copiando.hecho}/${copiando.total}…` : carpeta ? 'Mi copia' : 'Copia local'}
                  </Button>
                </Tooltip>
                <Menu anchorEl={menuLocal} open={menuLocal !== null} onClose={() => setMenuLocal(null)}>
                  {!carpeta && <MenuItem onClick={() => void elegirLocal()}>Elegir la carpeta de este equipo…</MenuItem>}
                  {carpeta && [
                    <MenuItem key="sel" disabled={!seleccion.size} onClick={() => void copiarLocal(fotos.filter((f) => seleccion.has(f.id)))}>Guardar las marcadas ({seleccion.size})</MenuItem>,
                    <MenuItem key="vista" disabled={!fotos.length} onClick={() => void copiarLocal(fotos)}>Guardar esta vista ({fotos.length})</MenuItem>,
                    <MenuItem key="faltan" disabled={!fotos.some((f) => !locales?.has(f.id))} onClick={() => void copiarLocal(fotos.filter((f) => !locales?.has(f.id)))}>Guardar lo que falta de esta vista</MenuItem>,
                    <MenuItem key="dir" onClick={() => void elegirLocal()}>Cambiar la carpeta ({carpeta.name})</MenuItem>,
                    <MenuItem key="olv" onClick={() => { setMenuLocal(null); void olvidarCarpetaLocal(); setCarpeta(null); setLocales(null) }}>Dejar de usar la copia local</MenuItem>,
                  ]}
                </Menu>
              </>
            )}
            {!angosta && (
              <Tooltip title="Tamaño de las miniaturas">
                <Slider size="small" min={100} max={320} step={10} value={tamano} onChange={(_, v) => setTamano(v as number)} sx={{ width: 110, mx: 1 }} aria-label="Tamaño de las miniaturas" />
              </Tooltip>
            )}
            {!soloLectura && (
              <>
                <input ref={entrada} type="file" accept={ACEPTA} multiple hidden onChange={(e) => void subir(e.target.files)} />
                <ButtonGroup variant="contained" disabled={subida !== null} disableElevation>
                  <Tooltip title="Fotos (JPG, PNG, WEBP, HEIC, TIFF) o videos (MP4, MOV, WEBM): se ordenan solas por su fecha">
                    <Button startIcon={<UploadIcon />} onClick={() => elegirArchivos(null)}>Subir</Button>
                  </Tooltip>
                  <Button size="small" aria-label="Subir a una actividad" onClick={(e) => setMenuSubir(e.currentTarget)} sx={{ px: 0.25, minWidth: '28px !important' }}>
                    <ArrowDropDownIcon fontSize="small" />
                  </Button>
                </ButtonGroup>
                <Menu anchorEl={menuSubir} open={!!menuSubir} onClose={() => setMenuSubir(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                  <MenuItem dense onClick={() => elegirArchivos('semana')}>A una Semana de Representación…</MenuItem>
                  <MenuItem dense onClick={() => elegirArchivos('otra')}>A otra actividad…</MenuItem>
                </Menu>
              </>
            )}
          </Box>

          {subida && (
            <Box sx={{ mb: 1.5 }}>
              <LinearProgress variant={subida.fase === 'revisando' ? 'indeterminate' : 'determinate'}
                value={subida.total ? (subida.enviado / subida.total) * 100 : (subida.listos / Math.max(1, subida.archivos)) * 100} />
              <Typography variant="caption" color="text.secondary">
                {subida.fase === 'revisando'
                  ? `Buscando duplicados: ${subida.listos} de ${subida.archivos}…`
                  : `Subiendo ${subida.listos} de ${subida.archivos} · ${Math.round((subida.total ? subida.enviado / subida.total : 1) * 100)} %`
                    + (subida.yaEstaban ? ` · ${subida.yaEstaban} ya estaban` : '')
                    + (subida.fallaron ? ` · ${subida.fallaron} con problema` : '')
                    + ' · no cierre esta pestaña'}
              </Typography>
            </Box>
          )}

          {/* Encabezado de la vista. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, minHeight: 32 }}>
            <Typography sx={{ fontWeight: 650, fontSize: 16, '&::first-letter': { textTransform: 'uppercase' } }}>{tituloVista}</Typography>
            {!enParecidas && <Typography variant="body2" color="text.secondary">{total} foto{total === 1 ? '' : 's'}</Typography>}
            <Box sx={{ flex: 1 }} />
            {!enParecidas && <ToggleButtonGroup size="small" exclusive value={enMapa ? 'mapa' : 'cuadricula'} onChange={(_, v) => v && ir({ vista: v === 'mapa' ? 'mapa' : null })} aria-label="Ver como">
              <ToggleButton value="cuadricula" aria-label="Cuadrícula" sx={{ px: 1 }}><Tooltip title="Cuadrícula"><GridViewOutlinedIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="mapa" aria-label="Mapa" sx={{ px: 1 }}><Tooltip title="Mapa: dónde se tomó cada foto y los lugares con nombre"><MapOutlinedIcon fontSize="small" /></Tooltip></ToggleButton>
            </ToggleButtonGroup>}
            {albumActual && !soloLectura && (
              <>
                <Tooltip title="Cambiar nombre, fecha o descripción"><IconButton size="small" onClick={() => setAlbum(albumActual)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Quitar el álbum (las fotos se quedan)"><IconButton size="small" onClick={() => void quitarAlbum()}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
              </>
            )}
            {enPapelera && (
              <Typography variant="caption" color="text.secondary">Lo que está aquí no se borra: se restaura cuando haga falta.</Typography>
            )}
          </Box>
          {!enParecidas && <FiltrosActivos p={p} ir={ir} />}
          {albumActual?.descripcion && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{albumActual.descripcion}</Typography>}
          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

          {enParecidas ? (
            <Parecidas soloLectura={soloLectura} avisar={avisar} vuelta={vuelta}
              alAbrir={(fs, i) => { setFotosAparte(fs); setAbierta(i) }} />
          ) : enMapa ? (
            <Suspense fallback={<Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress size={24} /></Box>}>
              <Mapa consulta={consulta} lugares={lugares} soloLectura={soloLectura} avisar={avisar}
                alAbrir={(fs) => { if (fs.length) { setFotosAparte(fs); setAbierta(0) } }}
                alCambiarLugares={recargar} alVerLugar={(nombre) => ir({ vista: null, lugar: nombre })} />
            </Suspense>
          ) : !cargando && fotos.length === 0 && !error ? (
            <EstadoVacio
              icono={<PhotoLibraryOutlinedIcon />}
              titulo={facetas?.total === 0 && !enPapelera ? 'La Mediateca está vacía' : 'No hay fotos en esta vista'}
              texto={facetas?.total === 0 && !enPapelera
                ? 'Suba las fotos originales (o arrástrelas aquí). Se guardan una sola vez y se editan sin tocar el original.'
                : 'Cambie la búsqueda o elija otra vista en el panel.'}
              accion={!soloLectura && !enPapelera ? <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => elegirArchivos(null)}>Subir fotos</Button> : undefined}
            />
          ) : (
            <Cuadricula fotos={fotos} alto={tamano} seleccion={seleccion} alMarcar={marcar} alAbrir={setAbierta}
              hayMas={siguiente !== null} cargando={cargando} alPedirMas={() => siguiente !== null && !cargando && void cargar(siguiente)}
              agrupar={p.get('marca') || p.get('prensa') ? 'ninguno' : agrupar} albumes={new Map((facetas?.albumes ?? []).map((a) => [a.id, a.nombre]))} locales={locales} />
          )}
          {porSubir && (
            <DialogoSubir archivos={porSubir} clase={claseSubida.current ?? 'semana'} albumActual={albumActual ? { id: albumActual.id, nombre: albumActual.nombre } : null} alCerrar={() => setPorSubir(null)} alSubir={(e) => void subirDeVerdad(porSubir, e)} />
          )}
        </Box>

        {arrastrando && (
          <Box sx={{ position: 'absolute', inset: 8, zIndex: 5, border: `2px dashed ${PALETA.guinda}`, borderRadius: 2, bgcolor: `${PALETA.superficie}EB`, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            <Box sx={{ textAlign: 'center', color: 'primary.main' }}>
              <UploadIcon sx={{ fontSize: 48 }} />
              <Typography sx={{ fontWeight: 600 }}>Suelte las fotos o los videos para subirlos{albumActual ? ` a «${albumActual.nombre}»` : ''}</Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Barra de acciones en lote. */}
      {n > 0 && (
        <Paper elevation={6} sx={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: { xs: 70, sm: 16 }, zIndex: (t) => t.zIndex.appBar,
          display: 'flex', alignItems: 'center', gap: 0.25, px: 1, py: 0.5, borderRadius: 3, maxWidth: 'calc(100vw - 16px)', overflowX: 'auto',
        }}>
          <Tooltip title="Soltar la selección (Esc)"><IconButton size="small" onClick={() => setSeleccion(new Set())}><CloseIcon fontSize="small" /></IconButton></Tooltip>
          <Typography sx={{ fontWeight: 600, fontSize: 14, px: 0.5, whiteSpace: 'nowrap' }}>{n} marcada{n === 1 ? '' : 's'}</Typography>
          {!soloLectura && !enPapelera && (
            <>
              <Tooltip title="Etiquetas, personas y lugar"><IconButton onClick={() => setEtiquetar(true)}><LocalOfferOutlinedIcon /></IconButton></Tooltip>
              <Tooltip title="Mover a un álbum"><IconButton onClick={(e) => setMenu({ cual: 'album', ancla: e.currentTarget })}><DriveFileMoveOutlinedIcon /></IconButton></Tooltip>
              <Tooltip title="Selección y color (Alt+3 aceptar · Alt+2 pendiente · Alt+1 rechazar · Alt+0 quitar)"><IconButton onClick={(e) => setDepurar(e.currentTarget)}><PlaylistAddCheckIcon /></IconButton></Tooltip>
              <Tooltip title="Estado: por revisar, pública, reservada"><IconButton onClick={(e) => setMenu({ cual: 'estado', ancla: e.currentTarget })}><FlagOutlinedIcon /></IconButton></Tooltip>
              <Tooltip title={todasFavoritas ? 'Quitar de favoritas' : 'Marcar como favoritas'}>
                <IconButton onClick={() => void lote({ favorita: !todasFavoritas }, todasFavoritas ? '{n} foto(s) fuera de favoritas.' : '{n} foto(s) en favoritas.')}>
                  {todasFavoritas ? <StarIcon /> : <StarBorderIcon />}
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title="Descargar con sus ajustes (varias: .zip)"><IconButton onClick={(e) => setMenu({ cual: 'descargar', ancla: e.currentTarget })}><FileDownloadOutlinedIcon /></IconButton></Tooltip>
          {!soloLectura && (enPapelera ? (
            <Tooltip title="Restaurar"><IconButton onClick={() => void lote({ papelera: false }, '{n} foto(s) restaurada(s).')}><RestoreFromTrashOutlinedIcon /></IconButton></Tooltip>
          ) : (
            <Tooltip title="Mandar a la papelera"><IconButton onClick={() => void lote({ papelera: true }, '{n} foto(s) en la papelera (se pueden restaurar).')}><DeleteOutlineIcon /></IconButton></Tooltip>
          ))}
        </Paper>
      )}
      <Popover open={depurar !== null} anchorEl={depurar} onClose={() => setDepurar(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }} transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 380, maxWidth: 'calc(100vw - 16px)' } } }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{n} marcada{n === 1 ? '' : 's'}</Typography>
        <Depuracion seleccion={comun('seleccion') as Foto['seleccion']} color={comun('color')}
          alCambiar={(c) => {
            setDepurar(null)
            const etq = c.seleccion !== undefined
              ? (c.seleccion ? `{n} foto(s): ${SELECCIONES.find((x) => x.valor === c.seleccion)?.etiqueta.toLowerCase()}.` : '{n} foto(s) sin marca.')
              : (c.color ? `{n} foto(s) en ${c.color}.` : '{n} foto(s) sin color.')
            void lote(c, etq)
          }} />
      </Popover>
      <Menu anchorEl={menu?.ancla} open={menu !== null} onClose={() => setMenu(null)}>
        {menu?.cual === 'album' && [
          ...(facetas?.albumes ?? []).map((a) => (
            <MenuItem key={a.id} onClick={() => { setMenu(null); void lote({ album_id: a.id }, `{n} foto(s) en «${a.nombre}».`) }}>{a.nombre}</MenuItem>
          )),
          <MenuItem key="nuevo" onClick={() => { setMenu(null); setAlbum({}) }}><AddIcon fontSize="small" sx={{ mr: 1 }} />Nuevo álbum…</MenuItem>,
          <MenuItem key="sin" onClick={() => { setMenu(null); void lote({ album_id: null }, '{n} foto(s) fuera de su álbum.') }}>Sacar del álbum</MenuItem>,
        ]}
        {menu?.cual === 'estado' && ESTADOS.map((e) => (
          <MenuItem key={e.valor} onClick={() => { setMenu(null); void lote({ estado: e.valor }, `{n} foto(s): ${e.etiqueta.toLowerCase()}.`) }}>
            <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: e.color, display: 'inline-block', mr: 1 }} />
            {e.etiqueta}
          </MenuItem>
        ))}
        {menu?.cual === 'descargar' && PRESETS.map((x) => <MenuItem key={x.clave} onClick={() => void descargar(x.clave)}>{x.etiqueta}</MenuItem>)}
      </Menu>

      <Visor fotos={fotosAparte ?? fotos} indice={abierta} alCambiarIndice={(i) => { setAbierta(i); if (i === null) setFotosAparte(null) }} albumes={facetas?.albumes ?? []} lugares={lugares}
        etiquetas={etiquetasConocidas} personas={personasConocidas} soloLectura={soloLectura}
        alActualizar={(f) => { reemplazar(f); recargarFacetas(); if (enParecidas) setVuelta((v) => v + 1) }} alEditar={setEditando} alPapelera={(f, m) => void papelera(f, m)} avisar={avisar} />
      <Editor foto={editando} alCerrar={() => setEditando(null)} alGuardar={reemplazar} avisar={avisar} />
      <Filtros abierto={filtrando} alCerrar={() => setFiltrando(false)} consulta={consulta} p={p} ir={ir} total={total} />
      <DialogoAlbum album={album} alCerrar={() => setAlbum(null)} alGuardar={guardarAlbum} />
      <DialogoEtiquetar abierto={etiquetar} n={n} etiquetas={etiquetasConocidas} personas={personasConocidas} alCerrar={() => setEtiquetar(false)}
        alAplicar={async (c) => { setEtiquetar(false); await lote(c, '{n} foto(s) etiquetada(s).') }} />
      <Snackbar open={aviso !== null} autoHideDuration={6000} onClose={() => setAviso(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {aviso ? <Alert severity={aviso.tipo} onClose={() => setAviso(null)} sx={{ maxWidth: 640 }}>{aviso.texto}</Alert> : undefined}
      </Snackbar>
    </Marco>
  )
}
