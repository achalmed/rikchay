/**
 * Lo que la web de la Mediateca ofrece a otros módulos (fase 10.2b, 2026-10-20): el equivalente web de «medios.v1».
 * Nadie fuera de la Mediateca importa sus archivos internos; solo esto y su manifiesto (`@qillqa/rikchay/publico` y
 * `/modulo`; lo comprueba la prueba de fronteras de Qillqa). Lo usa el anfitrión para elegir fotos y mostrarlas.
 */
export { traerImagen } from './modelo'
export type { Foto } from './modelo'
export { default as Selector } from './Selector'
export { filasJustificadas } from './Cuadricula'
