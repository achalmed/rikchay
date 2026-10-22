"""Las tablas de la Mediateca, en SU PROPIA base de datos (2026-10-19; docs/plataforma/mediateca-central.md de Qillqa §2.2).

Edison: «una biblioteca multimedia… las etiquetas, categorías, metadatos y relaciones en base de datos»;
la Mediateca es solo de la entidad, con carpeta (`MEDIATECA_DIR`) y base (`mediateca`) propias, y no
depende de digiKam: copia sus buenas prácticas (selección aceptada/pendiente/rechazada, color, árbol de
etiquetas, personas con su región de cara, lugares, versiones) y las tiene ella misma.

Viven sobre `BaseMediateca`, no sobre la Base del anfitrión: su `create_all` no las crea, y la sesión es otra
(`rikchay.db.obtener_sesion_mediateca`). Nada aquí tiene clave foránea hacia la
base documental: el usuario o el documento de otro lado se guarda como número o texto (`subido_por`,
`media_usos.referencia`). `fototeca_fotos` y `fototeca_albumes` conservan su nombre (el que tenían en la
base documental) para que la migración copie las filas tal cual.

Archivos (rikchay/fototeca.py): los originales en `<MEDIATECA_DIR>/AAAA/AAAAMMDD_HHMMSS.ext` (fecha de
la toma; si coincide, `_2`, `_3`…); los activos de marca en `<MEDIATECA_DIR>/marca/<categoría>/<nombre>`
(sin fecha: un logotipo no la tiene); los derivados, regenerables, en `<MEDIATECA_DIR>/cache/`.
"""

from datetime import datetime

from sqlalchemy import Computed, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from tiqsi.bandeja_sql import tabla_bandeja

# De dónde salió la fecha de la toma (la del nombre del archivo).
FUENTES_FECHA = ("exif", "digikam", "nombre", "archivo", "subida")
# El flujo de depuración de digiKam: aceptada, pendiente o rechazada.
SELECCIONES = ("", "aceptada", "pendiente", "rechazada")
# La etiqueta de color (la de digiKam, sin «ninguna»: esa es la cadena vacía).
COLORES = ("", "rojo", "naranja", "amarillo", "verde", "azul", "magenta", "gris", "negro", "blanco")
# Fotos y videos de actividades, activos de marca (logotipos, retratos, marcos, recursos) o lo que
# produce Prensa (posts, historias, portadas, videos; 2026-10-20, servicios/estudio_mediateca.py de Qillqa).
AMBITOS = ("actividad", "marca", "prensa")
CATEGORIAS_MARCA = ("logo", "retrato", "marco", "recurso", "color")


# El índice de texto (2026-10-19): título, pie, lugar, cámara, archivo, etiquetas y personas, en minúsculas, sin
# tildes y con todo signo vuelto espacio («IMG_2034.jpg» → «img 2034 jpg»), en la configuración «simple» (sin
# raíces: los nombres propios no se recortan). La búsqueda (rikchay/fototeca.py::palabras_busqueda) normaliza las
# palabras igual y las busca por prefijo. Es una columna generada: PostgreSQL la mantiene sola.
TILDES = ("áéíóúüñàèìòù", "aeiouunaeiou")
EXPR_BUSQUEDA = (
    "to_tsvector('simple'::regconfig, regexp_replace(translate(lower("
    "coalesce(titulo, '') || ' ' || coalesce(descripcion, '') || ' ' || coalesce(lugar, '') || ' ' || "
    "coalesce(camara, '') || ' ' || coalesce(nombre_original, '') || ' ' || coalesce(etiquetas::text, '') || ' ' || "
    f"coalesce(personas::text, '')), '{TILDES[0]}', '{TILDES[1]}'), '[^a-z0-9]+', ' ', 'g'))"
)


class BaseMediateca(DeclarativeBase):
    pass


class AlbumFoto(BaseMediateca):
    """Un álbum (2026-10-06): agrupa fotos por actividad o tema («SR-05 · A-01 · Visita a la UGEL»).
    Una foto está en un álbum o en ninguno; quitar el álbum no toca sus fotos."""

    __tablename__ = "fototeca_albumes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200))
    descripcion: Mapped[str] = mapped_column(Text, default="")
    # Fecha del evento (texto AAAA-MM-DD, como las demás fechas de la plataforma).
    fecha: Mapped[str] = mapped_column(String(10), default="")
    # Sin clave foránea: la portada puede ir a la papelera sin bloquear nada.
    portada_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # actividad | coleccion | importacion (los álbumes que vienen de una carpeta de origen).
    tipo: Mapped[str] = mapped_column(String(20), default="actividad", server_default="actividad")
    # Id de la cuenta en la base documental (sin clave foránea: otra base).
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Foto(BaseMediateca):
    """Una fotografía, un video o un activo de marca de la Mediateca.

    El ORIGINAL se guarda una sola vez (lo identifica su SHA-256) y nunca se modifica: toda edición vive
    en `ajustes` y se aplica al servir la vista o al exportar. Eliminar es mandar a la papelera
    (`eliminada_en`); no hay borrado físico."""

    __tablename__ = "fototeca_fotos"

    id: Mapped[int] = mapped_column(primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    nombre_original: Mapped[str] = mapped_column(String(300), default="")
    # Ruta relativa a MEDIATECA_DIR: «2026/20261018_182530.jpg» o «marca/logo/puno-guinda.pdf».
    archivo: Mapped[str] = mapped_column(String(300))
    # 'foto' | 'video' | 'documento' (un logotipo en PDF o un .ai de la marca: se guarda, no se edita).
    medio: Mapped[str] = mapped_column(String(10), default="foto", server_default="foto")
    duracion: Mapped[float | None] = mapped_column(nullable=True)
    bytes: Mapped[int] = mapped_column(Integer, default=0)
    # Medidas ya giradas según EXIF (como se ve la foto, sin ajustes).
    ancho: Mapped[int] = mapped_column(Integer, default=0)
    alto: Mapped[int] = mapped_column(Integer, default=0)
    tomada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fecha_exif: Mapped[bool] = mapped_column(default=False)
    # exif | digikam | nombre | archivo | subida (FUENTES_FECHA); una fecha dudosa se marca para revisar.
    fecha_fuente: Mapped[str] = mapped_column(String(10), default="subida", server_default="subida")
    revisar_fecha: Mapped[bool] = mapped_column(default=False, server_default="false")
    camara: Mapped[str] = mapped_column(String(160), default="")
    lat: Mapped[float | None] = mapped_column(nullable=True)
    lon: Mapped[float | None] = mapped_column(nullable=True)
    exif: Mapped[dict] = mapped_column(JSONB, default=dict)
    titulo: Mapped[str] = mapped_column(String(300), default="")
    descripcion: Mapped[str] = mapped_column(Text, default="")
    lugar: Mapped[str] = mapped_column(String(200), default="")
    lugar_id: Mapped[int | None] = mapped_column(ForeignKey("media_lugares.id", ondelete="SET NULL"), nullable=True)
    etiquetas: Mapped[list] = mapped_column(JSONB, default=list)
    personas: Mapped[list] = mapped_column(JSONB, default=list)
    # por_revisar | publica | reservada (como las fotos de la semana).
    estado: Mapped[str] = mapped_column(String(20), default="por_revisar")
    favorita: Mapped[bool] = mapped_column(default=False)
    calificacion: Mapped[int] = mapped_column(Integer, default=0)
    # Depuración como en digiKam: '' | aceptada | pendiente | rechazada; y una etiqueta de color.
    seleccion: Mapped[str] = mapped_column(String(10), default="", server_default="")
    color: Mapped[str] = mapped_column(String(12), default="", server_default="")
    # actividad | marca | prensa (AMBITOS); en la marca, su categoría (logo, retrato, marco, recurso, color);
    # en prensa, su formato (post, historia, portada, video).
    ambito: Mapped[str] = mapped_column(String(10), default="actividad", server_default="actividad")
    categoria: Mapped[str] = mapped_column(String(20), default="", server_default="")
    album_id: Mapped[int | None] = mapped_column(ForeignKey("fototeca_albumes.id", ondelete="SET NULL"), nullable=True)
    # Edición NO destructiva: {rotar, voltear, voltear_v, enderezar, recorte, brillo, contraste, saturacion}.
    ajustes: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Dónde se usa: [{tipo: semana|proyecto|documento, id, codigo?, etiqueta?}].
    vinculos: Mapped[list] = mapped_column(JSONB, default=list)
    subido_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    eliminada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # La huella perceptual (dHash de 64 bits en hexadecimal; rikchay/parecidas.py): NULL = sin calcular, '' = no se pudo.
    hash_perceptual: Mapped[str | None] = mapped_column(String(16), nullable=True)
    busqueda: Mapped[str | None] = mapped_column(TSVECTOR, Computed(EXPR_BUSQUEDA, persisted=True), nullable=True,
                                                 deferred=True)


class Etiqueta(BaseMediateca):
    """Árbol de etiquetas (como el de digiKam): tema, lugar, evento u objeto; manual o automática."""

    __tablename__ = "media_etiquetas"
    __table_args__ = (UniqueConstraint("padre_id", "nombre"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    padre_id: Mapped[int | None] = mapped_column(ForeignKey("media_etiquetas.id", ondelete="CASCADE"), nullable=True)
    nombre: Mapped[str] = mapped_column(String(160))
    tipo: Mapped[str] = mapped_column(String(10), default="tema")
    origen: Mapped[str] = mapped_column(String(10), default="manual")


class EtiquetaFoto(BaseMediateca):
    __tablename__ = "media_etiqueta_fotos"

    etiqueta_id: Mapped[int] = mapped_column(ForeignKey("media_etiquetas.id", ondelete="CASCADE"), primary_key=True)
    foto_id: Mapped[int] = mapped_column(ForeignKey("fototeca_fotos.id", ondelete="CASCADE"), primary_key=True)


class Persona(BaseMediateca):
    """Una persona que aparece en las fotos; si está en el directorio, su id de allá."""

    __tablename__ = "media_personas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200), unique=True)
    persona_directorio: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Cara(BaseMediateca):
    """La región de una cara en una foto (x, y, ancho, alto normalizados 0–1), con quién es."""

    __tablename__ = "media_caras"

    id: Mapped[int] = mapped_column(primary_key=True)
    foto_id: Mapped[int] = mapped_column(ForeignKey("fototeca_fotos.id", ondelete="CASCADE"), index=True)
    persona_id: Mapped[int | None] = mapped_column(ForeignKey("media_personas.id", ondelete="SET NULL"), nullable=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    ancho: Mapped[float] = mapped_column(Float)
    alto: Mapped[float] = mapped_column(Float)
    confianza: Mapped[float | None] = mapped_column(Float, nullable=True)
    origen: Mapped[str] = mapped_column(String(10), default="manual")


class Lugar(BaseMediateca):
    """Un lugar con nombre, además de las coordenadas de cada foto."""

    __tablename__ = "media_lugares"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200), unique=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    radio_m: Mapped[int] = mapped_column(Integer, default=200)


class Version(BaseMediateca):
    """Una versión derivada de un original (edición, recorte, exportación), como el historial de digiKam."""

    __tablename__ = "media_versiones"

    id: Mapped[int] = mapped_column(primary_key=True)
    original_id: Mapped[int] = mapped_column(ForeignKey("fototeca_fotos.id", ondelete="CASCADE"), index=True)
    derivada_id: Mapped[int] = mapped_column(ForeignKey("fototeca_fotos.id", ondelete="CASCADE"), index=True)
    tipo: Mapped[str] = mapped_column(String(12), default="edicion")
    ajustes: Mapped[dict] = mapped_column(JSONB, default=dict)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RutaAnterior(BaseMediateca):
    """Dónde estaba y cómo se llamaba un archivo antes de entrar a la Mediateca: lo que permite reparar
    cualquier referencia vieja (un fotos.yaml, un perfil) y deshacer la migración."""

    __tablename__ = "media_rutas_anteriores"
    __table_args__ = (UniqueConstraint("ruta"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    foto_id: Mapped[int] = mapped_column(ForeignKey("fototeca_fotos.id", ondelete="CASCADE"), index=True)
    ruta: Mapped[str] = mapped_column(Text)
    # fototeca | banco | marca | latex | digikam
    origen: Mapped[str] = mapped_column(String(12))
    hasta: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Uso(BaseMediateca):
    """Dónde se usa una imagen fuera de la Mediateca (semana, documento, proyecto, prensa, latex, web)."""

    __tablename__ = "media_usos"
    __table_args__ = (UniqueConstraint("foto_id", "tipo", "referencia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    foto_id: Mapped[int] = mapped_column(ForeignKey("fototeca_fotos.id", ondelete="CASCADE"), index=True)
    tipo: Mapped[str] = mapped_column(String(12))
    referencia: Mapped[str] = mapped_column(String(200))
    desde: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Columnas añadidas después de crear la base e índices de búsqueda (idempotentes; los aplica
# rikchay.db.crear_tablas al arrancar, en este orden).
INDICES = (
    f"ALTER TABLE fototeca_fotos ADD COLUMN IF NOT EXISTS busqueda tsvector GENERATED ALWAYS AS ({EXPR_BUSQUEDA}) STORED",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_busqueda ON fototeca_fotos USING gin (busqueda)",
    "ALTER TABLE fototeca_fotos ADD COLUMN IF NOT EXISTS hash_perceptual varchar(16)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_camara ON fototeca_fotos (camara)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_lugar ON fototeca_fotos (lugar)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_etiquetas ON fototeca_fotos USING gin (etiquetas)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_personas ON fototeca_fotos USING gin (personas)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_vinculos ON fototeca_fotos USING gin (vinculos)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_tomada ON fototeca_fotos (tomada_en DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_album ON fototeca_fotos (album_id)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_ambito ON fototeca_fotos (ambito, categoria)",
    "CREATE INDEX IF NOT EXISTS fototeca_fotos_seleccion ON fototeca_fotos (seleccion, color)",
)


# Su bandeja de salida durable (fase 10.2b, 2026-10-20; tiqsi.bandeja): el evento («fototeca.foto.subida») entra en la
# misma transacción que la foto y el repartidor del anfitrión lo entrega al bus, aunque la API se reinicie entre medio.
BANDEJA = tabla_bandeja(BaseMediateca.metadata)
