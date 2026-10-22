/**
 * COPIA LOCAL de la Mediateca (Edison 2026-10-10): cada persona del equipo tiene en su laptop
 * una copia de las fotos y videos, organizada sola por «Año/Mes» dentro de la carpeta que
 * eligió una vez (su «Imágenes» o «Pictures»). No se baja nada sin pedirlo: la cuadrícula dice
 * qué está ya en este equipo y qué solo en la Mediateca, y se guarda lo marcado, una vista
 * entera o lo que falte. Lo que se SUBE desde este equipo también se copia ahí.
 *
 * El índice `.qillqa-mediateca.json` vive dentro de la carpeta (id → ruta relativa): sobrevive a
 * los cambios de enlace del sistema. Solo Chrome/Edge (File System Access API), como la
 * sincronización de documentos.
 */
import { guardarHandle, leerHandle, olvidarHandle, token } from '@qillqa/tiqsi'
import type { Foto } from './modelo'

const CLAVE_HANDLE = 'mediateca'
const ARCHIVO_INDICE = '.qillqa-mediateca.json'
// Con este nombre lo dejó la copia local antes del 2026-10-22: se lee si falta el nuevo y se reescribe con el nuevo.
const ARCHIVO_INDICE_ANTES = '.sgdp-mediateca.json'

export const soportaCopiaLocal = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function carpetaLocal(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await leerHandle(CLAVE_HANDLE)
  } catch {
    return null
  }
}

export async function elegirCarpetaLocal(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }
  try {
    const dir = await w.showDirectoryPicker({ id: 'qillqa-mediateca', mode: 'readwrite', startIn: 'pictures' })
    await guardarHandle(dir, CLAVE_HANDLE)
    return dir
  } catch {
    return null
  }
}

export const olvidarCarpetaLocal = () => olvidarHandle(CLAVE_HANDLE)

export async function permisoLocal(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const d = dir as unknown as { queryPermission: (o: object) => Promise<string>; requestPermission: (o: object) => Promise<string> }
  if ((await d.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return (await d.requestPermission({ mode: 'readwrite' })) === 'granted'
}

type Indice = Record<string, string>

async function leerIndice(dir: FileSystemDirectoryHandle): Promise<Indice> {
  try {
    const f = await (await dir.getFileHandle(ARCHIVO_INDICE)).getFile()
    return JSON.parse(await f.text()) as Indice
  } catch {
    try {
      const f = await (await dir.getFileHandle(ARCHIVO_INDICE_ANTES)).getFile()
      return JSON.parse(await f.text()) as Indice
    } catch {
      return {}
    }
  }
}

async function guardarIndice(dir: FileSystemDirectoryHandle, idx: Indice) {
  const fh = await dir.getFileHandle(ARCHIVO_INDICE, { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(idx))
  await w.close()
}

/** Ids que ya están en este equipo (según el índice de la carpeta). */
export async function idsLocales(dir: FileSystemDirectoryHandle): Promise<Set<number>> {
  return new Set(Object.keys(await leerIndice(dir)).map(Number))
}

/** «2026/09/nombre.jpg»: por la fecha de la toma (o la de subida si no hay EXIF). */
export function rutaLocal(f: Pick<Foto, 'tomada_en' | 'nombre_original' | 'id'>): string[] {
  const d = f.tomada_en ? new Date(f.tomada_en) : new Date()
  const anio = String(d.getFullYear())
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const nombre = (f.nombre_original || `foto-${f.id}.jpg`).replace(/[\\/:*?"<>|]/g, '_')
  return [anio, mes, nombre]
}

async function escribir(dir: FileSystemDirectoryHandle, partes: string[], blob: Blob): Promise<string> {
  const nombre = partes[partes.length - 1]
  let actual = dir
  for (const p of partes.slice(0, -1)) actual = await actual.getDirectoryHandle(p, { create: true })
  // Dos fotos con el mismo nombre y distinto contenido no se pisan: «nombre (2).jpg».
  let final = nombre
  let n = 2
  for (;;) {
    try {
      await actual.getFileHandle(final)
      const punto = nombre.lastIndexOf('.')
      final = punto > 0 ? `${nombre.slice(0, punto)} (${n})${nombre.slice(punto)}` : `${nombre} (${n})`
      n += 1
    } catch {
      break
    }
  }
  const fh = await actual.getFileHandle(final, { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
  return [...partes.slice(0, -1), final].join('/')
}

export interface ResumenCopia {
  guardadas: number
  yaEstaban: number
  errores: number
}

/** Guarda en la carpeta local las fotos dadas (las que faltan), bajando el original. */
export async function guardarLocal(
  dir: FileSystemDirectoryHandle,
  fotos: Foto[],
  alProgresar?: (hecho: number, total: number) => void,
  archivosYaEnMano?: Map<number, Blob>,
): Promise<ResumenCopia> {
  const idx = await leerIndice(dir)
  const r: ResumenCopia = { guardadas: 0, yaEstaban: 0, errores: 0 }
  const pendientes = fotos.filter((f) => !idx[String(f.id)])
  r.yaEstaban = fotos.length - pendientes.length
  let hecho = 0
  const ficha = token()
  for (const f of pendientes) {
    try {
      let blob = archivosYaEnMano?.get(f.id)
      if (!blob) {
        const resp = await fetch(`/api/fototeca/${f.id}/original`, { headers: ficha ? { Authorization: `Bearer ${ficha}` } : {} })
        if (!resp.ok) throw new Error('No se pudo bajar el original.')
        blob = await resp.blob()
      }
      idx[String(f.id)] = await escribir(dir, rutaLocal(f), blob)
      r.guardadas += 1
    } catch {
      r.errores += 1
    }
    hecho += 1
    alProgresar?.(hecho, pendientes.length)
  }
  await guardarIndice(dir, idx)
  return r
}
