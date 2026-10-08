"""
Script para importar y sincronizar automáticamente los puestos de los resguardantes
a partir de la página oficial del Directorio de D.G. (Directorio.html).
"""

import os
import re
import sys
import unicodedata
from lxml import html

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from backend.database import SessionLocal, ensure_schema_migrations
from backend.models import Resguardante


def strip_accents_and_normalize(text: str) -> str:
    if not text:
        return ""
    # Remover títulos y prefijos habituales (Dr., Lic., Ing., C.P., Mtro., C., etc.)
    text = re.sub(r"^(DR\.|DRA\.|LIC\.|ING\.|C\.P\.|MTRO\.|MTRA\.|M\.S\.T\.|L\.D\.G\.|C\.)\s+", "", text.strip(), flags=re.IGNORECASE)
    # Remover acentos
    nfkd = unicodedata.normalize("NFKD", text)
    clean = "".join([c for c in nfkd if not unicodedata.combining(c)])
    # Limpiar espacios y pasar a mayúsculas
    return re.sub(r"\s+", " ", clean).strip().upper()


def parse_directorio_html(html_path: str):
    with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
        doc = html.fromstring(f.read())

    resultados = []
    current_puesto = ""

    for tr in doc.xpath("//tr"):
        classes = (tr.get("class") or "").split()
        if "HTblHdr" in classes:
            hdr_text = "".join(tr.xpath(".//text()")).strip()
            # Descartar encabezados de columna de la tabla
            if hdr_text and not any(k in hdr_text.upper() for k in ["TELÉFONO", "TELEFONO", "CORREO", "EXTENSIÓN", "EXTENSION"]):
                current_puesto = hdr_text.strip()
        elif any(c in classes for c in ["HTblRow", "HTblRowAlt"]) and current_puesto:
            tds = tr.xpath("./td")
            if len(tds) >= 2:
                raw_name = "".join(tds[1].xpath(".//text()")).strip()
                if raw_name:
                    resultados.append({
                        "nombre_original": raw_name,
                        "nombre_norm": strip_accents_and_normalize(raw_name),
                        "puesto": current_puesto
                    })

    return resultados



def sync_puestos_to_db(html_path: str = "Directorio.html"):
    if not os.path.exists(html_path):
        print(f"Error: No se encontró el archivo '{html_path}'.")
        return

    ensure_schema_migrations()
    db = SessionLocal()

    try:
        registros_directorio = parse_directorio_html(html_path)
        print(f"Total registros leídos de {html_path}: {len(registros_directorio)}")

        resguardantes = db.query(Resguardante).all()
        print(f"Total resguardantes en base de datos: {len(resguardantes)}\n")

        actualizados = 0

        for resg in resguardantes:
            r_norm = strip_accents_and_normalize(resg.nombre)
            # Dividir partes del nombre para emparejamiento inteligente
            r_words = set(r_norm.split())

            match_puesto = None

            for d in registros_directorio:
                d_norm = d["nombre_norm"]
                d_words = set(d_norm.split())

                # Coincidencia exacta o intersección de apellidos/nombre
                if r_norm == d_norm or r_norm in d_norm or d_norm in r_norm:
                    match_puesto = d["puesto"]
                    break
                elif len(r_words.intersection(d_words)) >= min(3, len(r_words)):
                    match_puesto = d["puesto"]
                    break

            if match_puesto:
                resg.puesto = match_puesto.strip().upper()
                actualizados += 1
                print(f"✔ {resg.nombre} -> {resg.puesto}")
            else:
                puesto_actual = f"[{resg.puesto}]" if resg.puesto else "[Sin puesto]"
                print(f"  {resg.nombre} {puesto_actual} (Sin coincidencia en archivo)")

        db.commit()
        print(f"\nSincronización completada: {actualizados} resguardantes actualizados.")

    finally:
        db.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "Directorio.html"
    sync_puestos_to_db(path)
