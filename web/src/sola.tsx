/**
 * La Mediateca SOLA en el navegador (Rikchay): la cáscara mínima de Tiqsi con el módulo web de la Mediateca, contra el
 * anfitrión mínimo del backend (rikchay/sola.py). No importa nada de Qillqa: ni su marco, ni su sesión, ni su menú.
 * Se construye desde la raíz con `npm run web:construir`.
 */
import { createRoot } from 'react-dom/client'
import { CascaronMinimo } from '@qillqa/tiqsi/minimo'
import { MEDIATECA } from './componentes/fototeca/modulo'

createRoot(document.getElementById('root')!).render(<CascaronMinimo modulo={MEDIATECA} />)
