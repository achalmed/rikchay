"""Detector local de caras de la Mediateca (2026-10-19): propone regiones; nunca guarda nada.

Edison: «la Mediateca… con las capacidades de digiKam… e independiente». La detección es opcional y solo
PROPONE: la API devuelve las cajas y una persona confirma cada una poniéndole nombre (rikchay/caras.py). Va
en un archivo aparte, sin importar nada de `app`, para poder correr de dos maneras:

  - dentro de la API, si su intérprete trae OpenCV (`cv2`);
  - como programa, con otro intérprete que sí lo traiga (`CARAS_PYTHON`, por omisión el `python3` del PATH):
      python3 -I caras_detector.py IMAGEN [MODELO]   → JSON: [{"x", "y", "ancho", "alto", "confianza"}, …]
      python3 -I caras_detector.py --probar [MODELO] → sale 0 si OpenCV puede detectar con ese modelo

El modelo es YuNet (un .onnx, el de OpenCV Zoo; el único que sirve con OpenCV 5, que retiró las cascadas) o una
cascada de Haar (.xml, OpenCV 4); sin modelo, la cascada frontal que trae OpenCV 4 o la del sistema
(/usr/share/opencv4). Las cajas salen normalizadas (0–1) sobre la imagen que se le da:
la API le pasa la vista «cruda» (girada según el EXIF, sin ajustes), la misma sobre la que se marcan a mano.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CASCADAS = ("/usr/share/opencv4/haarcascades", "/usr/share/opencv/haarcascades")
HAAR = "haarcascade_frontalface_default.xml"


def _cascada() -> str | None:
    import cv2

    datos = getattr(getattr(cv2, "data", None), "haarcascades", "") or ""
    for carpeta in (datos, *CASCADAS):
        if carpeta and (Path(carpeta) / HAAR).is_file():
            return str(Path(carpeta) / HAAR)
    return None


def puede(modelo: str = "") -> str:
    """Con qué detecta («yunet» o «haar»); ValueError con el motivo si no puede."""
    import cv2

    if modelo.endswith(".onnx"):
        if not hasattr(cv2, "FaceDetectorYN"):
            raise ValueError("Este OpenCV no trae YuNet (FaceDetectorYN).")
        return "yunet"
    if not hasattr(cv2, "CascadeClassifier"):
        raise ValueError("Este OpenCV (5 o más) no trae cascadas de Haar: falta el modelo YuNet (.onnx).")
    if not (modelo.endswith(".xml") or _cascada()):
        raise ValueError("No hay cascada de Haar instalada.")
    return "haar"


def detectar(imagen: str, modelo: str = "") -> list[dict]:
    import cv2

    tipo = puede(modelo)
    img = cv2.imread(imagen)
    if img is None:
        raise ValueError("No se pudo leer la imagen.")
    alto, ancho = img.shape[:2]
    cajas: list[tuple[float, float, float, float, float | None]] = []
    if tipo == "yunet":
        det = cv2.FaceDetectorYN.create(modelo, "", (ancho, alto), 0.7, 0.3, 5000)
        _, caras = det.detect(img)
        for c in caras if caras is not None else []:
            cajas.append((float(c[0]), float(c[1]), float(c[2]), float(c[3]), float(c[-1])))
    else:
        ruta = modelo if modelo.endswith(".xml") else _cascada()
        gris = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        lado = max(24, int(min(ancho, alto) * 0.04))
        for (x, y, w, h) in cv2.CascadeClassifier(ruta).detectMultiScale(gris, 1.1, 6, minSize=(lado, lado)):
            cajas.append((float(x), float(y), float(w), float(h), None))
    salida = []
    for x, y, w, h, conf in cajas:
        x0, y0 = max(0.0, x / ancho), max(0.0, y / alto)
        salida.append({
            "x": round(x0, 5), "y": round(y0, 5),
            "ancho": round(min(w / ancho, 1 - x0), 5), "alto": round(min(h / alto, 1 - y0), 5),
            "confianza": round(conf, 3) if conf is not None else None,
        })
    return salida


if __name__ == "__main__":
    try:
        if sys.argv[1:2] == ["--probar"]:
            print(puede(sys.argv[2] if len(sys.argv) > 2 else ""))
            sys.exit(0)
        print(json.dumps(detectar(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "")))
    except (ImportError, ValueError) as e:
        print(e if isinstance(e, ValueError) else "OpenCV no está instalado.", file=sys.stderr)
        sys.exit(1)
