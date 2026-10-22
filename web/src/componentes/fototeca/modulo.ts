/**
 * El módulo web de la Mediateca (fase 10.2b del contrato de Tiqsi, 2026-10-20): su pantalla, su ruta y cómo entra
 * al menú del anfitrión. Qillqa arma con esto su entrada en el menú (navegacion.ts) y su ruta (App.tsx); la página
 * de la Mediateca SOLA (src/mediateca_sola.tsx), su cáscara mínima. Nadie más lo declara: un cambio aquí rige en
 * los dos. El nombre, en castellano y por su función.
 */
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { definirModuloWeb } from '@qillqa/tiqsi'

export const MEDIATECA = definirModuloWeb({
  // «Mediateca» (2026-10-10): fotos Y videos; el id y las rutas siguen siendo `fototeca`.
  id: 'fototeca',
  nombre: 'Mediateca',
  corto: 'Fotos',
  ruta: '/fototeca',
  icono: PhotoLibraryOutlinedIcon,
  descripcion: 'Las fotos originales de la entidad: subir, organizar en álbumes, etiquetar, editar y exportar para informes y publicaciones.',
  opciones: [
    { etiqueta: 'Todas', ruta: '/fototeca', icono: PhotoLibraryOutlinedIcon },
    { etiqueta: 'Por revisar', ruta: '/fototeca?ver=revisar', icono: RateReviewOutlinedIcon, ayuda: 'Las recién subidas: decidir si son públicas o reservadas' },
    { etiqueta: 'Favoritas', ruta: '/fototeca?ver=favoritas', icono: StarBorderIcon },
    { etiqueta: 'Papelera', ruta: '/fototeca?ver=papelera', icono: DeleteOutlineIcon, ayuda: 'Lo descartado; se restaura cuando haga falta' },
  ],
  cargar: () => import('../../paginas/Fototeca'),
})
