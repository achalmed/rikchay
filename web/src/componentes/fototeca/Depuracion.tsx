/**
 * DEPURACIÓN de la Mediateca (2026-10-19): la selección aceptada / pendiente / rechazada y la etiqueta
 * de color de digiKam, para una foto (el visor) o para las marcadas (la barra de la selección). Pulsar
 * lo que ya está elegido lo quita. Atajos: Alt+3 aceptada, Alt+2 pendiente, Alt+1 rechazada, Alt+0 sin
 * marca (`seleccionDeTecla` en modelo.ts).
 */
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import PendingOutlinedIcon from '@mui/icons-material/PendingOutlined'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import type { SvgIconProps } from '@mui/material/SvgIcon'
import { PALETA } from '@qillqa/tiqsi'
import { COLORES, SELECCIONES, type Seleccion } from './modelo'

export function IconoSeleccion({ valor, ...props }: { valor: Seleccion | undefined } & SvgIconProps) {
  if (valor === 'aceptada') return <CheckCircleOutlineIcon {...props} />
  if (valor === 'pendiente') return <PendingOutlinedIcon {...props} />
  if (valor === 'rechazada') return <HighlightOffIcon {...props} />
  return null
}

interface Props {
  seleccion?: Seleccion
  color?: string
  deshabilitado?: boolean
  alCambiar: (c: { seleccion?: Seleccion; color?: string }) => void
}

export default function Depuracion({ seleccion = '', color = '', deshabilitado, alCambiar }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        {SELECCIONES.map((s) => {
          const activa = seleccion === s.valor
          return (
            <Tooltip key={s.valor} title={`${s.etiqueta} (Alt+${s.tecla})`}>
              <ButtonBase disabled={deshabilitado} aria-pressed={activa} aria-label={s.etiqueta}
                onClick={() => alCambiar({ seleccion: activa ? '' : s.valor })}
                sx={{
                  flex: 1, gap: 0.5, py: 0.6, px: 1, borderRadius: 1.5, fontSize: 13, minWidth: 0,
                  border: '1px solid', borderColor: activa ? s.color : 'divider',
                  color: activa ? s.color : 'text.secondary', bgcolor: activa ? `${s.color}1A` : 'transparent',
                  fontWeight: activa ? 650 : 400,
                }}>
                <IconoSeleccion valor={s.valor} sx={{ fontSize: 17 }} />
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.etiqueta}</Box>
              </ButtonBase>
            </Tooltip>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.25 }}>Color</Typography>
        {COLORES.map((c) => {
          const activo = color === c.valor
          return (
            <Tooltip key={c.valor} title={activo ? `${c.etiqueta} (pulse para quitarlo)` : c.etiqueta}>
              <ButtonBase disabled={deshabilitado} aria-pressed={activo} aria-label={`Color ${c.etiqueta.toLowerCase()}`}
                onClick={() => alCambiar({ color: activo ? '' : c.valor })}
                sx={{
                  width: 22, height: 22, borderRadius: '50%', bgcolor: c.hex,
                  boxShadow: activo ? `0 0 0 2px ${PALETA.superficie}, 0 0 0 4px ${c.hex}` : `inset 0 0 0 1px rgba(0,0,0,.18)`,
                }} />
            </Tooltip>
          )
        })}
      </Box>
    </Box>
  )
}
