/**
 * PARECIDAS de la Mediateca (2026-10-20; backend/app/servicios/parecidas.py): las fotos que se ven casi iguales
 * (la misma re-codificada por WhatsApp, reducida, una ráfaga), agrupadas por su huella perceptual.
 *
 * «Quedarse con esta» acepta una y rechaza las demás del grupo (la depuración de digiKam): el grupo queda
 * resuelto y sale de la lista. Nada se borra; las rechazadas siguen en su álbum, apagadas. La primera vez se
 * calculan las huellas que falten, por tandas, con su avance.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { api, EstadoVacio, PALETA } from '@qillqa/tiqsi'
import FilterNoneOutlinedIcon from '@mui/icons-material/FilterNoneOutlined'
import { IconoSeleccion } from './Depuracion'
import { SELECCIONES, type Foto, diaDe, nombreDia, pesoLegible, traerImagen, urlMiniatura } from './modelo'

interface Grupo { fotos: Foto[]; distancia: number }
interface Respuesta { grupos: Grupo[]; calculadas: number; faltan: number }

const UMBRALES = [
  { valor: 'muy', etiqueta: 'Casi iguales' },
  { valor: 'parecidas', etiqueta: 'Parecidas' },
  { valor: 'algo', etiqueta: 'Algo parecidas' },
]

function Miniatura({ foto, alto }: { foto: Foto; alto: number }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let vivo = true
    traerImagen(urlMiniatura(foto)).then((u) => vivo && setUrl(u)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [foto])
  return (
    <Box sx={{ height: alto, aspectRatio: String(foto.proporcion || 1), maxWidth: '100%', borderRadius: 1, bgcolor: 'action.hover',
      backgroundImage: url ? `url(${url})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center',
      opacity: foto.seleccion === 'rechazada' ? 0.45 : 1 }} />
  )
}

interface Props {
  soloLectura: boolean
  avisar: (tipo: 'success' | 'error' | 'info', t: string) => void
  alAbrir: (fotos: Foto[], indice: number) => void
  /** Cambia cuando algo se guardó fuera (el visor): se vuelve a pedir la lista. */
  vuelta: number
}

export default function Parecidas({ soloLectura, avisar, alAbrir, vuelta }: Props) {
  const [umbral, setUmbral] = useState('parecidas')
  const [datos, setDatos] = useState<Grupo[] | null>(null)
  const [avance, setAvance] = useState<{ hechas: number; faltan: number } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const pedido = useRef(0)

  const cargar = useCallback(async () => {
    const id = ++pedido.current
    let hechas = 0
    try {
      for (;;) {
        const r = await api<Respuesta>(`/api/fototeca/parecidas?umbral=${umbral}`)
        if (id !== pedido.current) return
        hechas += r.calculadas
        if (r.faltan > 0) {
          setAvance({ hechas, faltan: r.faltan })
          continue
        }
        setAvance(null)
        setDatos(r.grupos)
        return
      }
    } catch (e) {
      if (id === pedido.current) {
        setAvance(null)
        avisar('error', e instanceof Error ? e.message : 'No se pudieron buscar las parecidas.')
      }
    }
  }, [umbral, avisar])
  useEffect(() => {
    void cargar()
  }, [cargar, vuelta])

  async function quedarse(g: Grupo, elegida: Foto) {
    setOcupado(true)
    try {
      const otras = g.fotos.filter((f) => f.id !== elegida.id && f.seleccion !== 'rechazada').map((f) => f.id)
      await api('/api/fototeca/lote', { method: 'PATCH', body: JSON.stringify({ ids: [elegida.id], seleccion: 'aceptada' }) })
      if (otras.length) await api('/api/fototeca/lote', { method: 'PATCH', body: JSON.stringify({ ids: otras, seleccion: 'rechazada' }) })
      avisar('success', `Queda una; ${otras.length} rechazada${otras.length === 1 ? '' : 's'} (siguen en su álbum).`)
      await cargar()
    } catch (e) {
      avisar('error', e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <TextField size="small" select value={umbral} onChange={(e) => setUmbral(e.target.value)} sx={{ minWidth: 170, bgcolor: 'background.paper' }} inputProps={{ 'aria-label': 'Cuánto se parecen' }}>
          {UMBRALES.map((u) => <MenuItem key={u.valor} value={u.valor}>{u.etiqueta}</MenuItem>)}
        </TextField>
        {datos && !avance && (
          <Typography variant="body2" color="text.secondary">{datos.length} grupo{datos.length === 1 ? '' : 's'} por revisar</Typography>
        )}
      </Box>
      {avance && (
        <Box sx={{ mb: 2, maxWidth: 420 }}>
          <LinearProgress variant="determinate" value={(avance.hechas / Math.max(1, avance.hechas + avance.faltan)) * 100} />
          <Typography variant="caption" color="text.secondary">Calculando las huellas: faltan {avance.faltan}…</Typography>
        </Box>
      )}
      {datos && !avance && datos.length === 0 && (
        <EstadoVacio icono={<FilterNoneOutlinedIcon />} titulo="No hay fotos parecidas por revisar"
          texto="Aquí aparecen las fotos que se ven casi iguales aunque sean archivos distintos (reenviadas, reducidas, ráfagas)." />
      )}
      {(datos ?? []).map((g) => (
        <Box key={g.fotos.map((f) => f.id).join('-')} sx={{ mb: 1.5, p: 1.25, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {g.fotos.length} fotos · {g.distancia === 0 ? 'indistinguibles' : `difieren en ${g.distancia} de 64`}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5 }}>
            {g.fotos.map((f, i) => {
              const sel = SELECCIONES.find((s) => s.valor === f.seleccion)
              return (
                <Box key={f.id} sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.5, maxWidth: 220 }}>
                  <Box component="button" type="button" onClick={() => alAbrir(g.fotos, i)} aria-label={`Abrir ${f.titulo || f.nombre_original}`}
                    sx={{ p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', position: 'relative', display: 'block', width: 'fit-content', alignSelf: 'flex-start' }}>
                    <Miniatura foto={f} alto={120} />
                    {sel && <IconoSeleccion valor={f.seleccion} sx={{ position: 'absolute', right: 4, bottom: 4, fontSize: 18, color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,.7))' }} />}
                  </Box>
                  <Typography variant="caption" sx={{ lineHeight: 1.3, '&::first-letter': { textTransform: 'uppercase' } }}>
                    {nombreDia(diaDe(f.tomada_en)).replace(/ de \d{4}$/, '')}{f.tomada_en ? `, ${f.tomada_en.slice(11, 16)}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                    {f.ancho} × {f.alto} · {pesoLegible(f.bytes)}{f.vinculos.length ? ` · se usa en ${f.vinculos.map((v) => v.etiqueta).filter(Boolean).join(', ')}` : ''}
                  </Typography>
                  {!soloLectura && (
                    <Button size="small" variant={f.seleccion === 'aceptada' ? 'contained' : 'outlined'} disabled={ocupado} onClick={() => void quedarse(g, f)}
                      sx={{ alignSelf: 'flex-start', ...(f.seleccion === 'aceptada' ? { bgcolor: PALETA.exito } : {}) }}>
                      Quedarse con esta
                    </Button>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
