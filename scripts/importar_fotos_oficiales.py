"""
Script para importar y descargar automáticamente las fotos de los activos oficiales de D.G.
Soporta:
1. Archivo HTML individual guardado desde el portal (ej. Inventario.html)
2. Archivo JSON exportado por el extractor del navegador (fotos_oficiales_cobach3.json)
"""

import os
import re
import json
import sqlite3
import argparse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "inventario.db")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
BASE_OFFICIAL_URL = "https://appsrv2016.cobachih.edu.mx"

os.makedirs(UPLOADS_DIR, exist_ok=True)

def parse_from_html(html_path: str):
    with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
        html = f.read()

    matches = re.findall(
        r'<b>C[oó]digo:\s*</b>\s*([0-9]+).*?href=[\"\'](/FileServer/Contraloria/FotosActivosFijos/([0-9]+\.(?:JPG|jpg)))[\"\']',
        html,
        re.DOTALL
    )
    
    results = []
    seen = set()
    for code, rel_url, filename in matches:
        if code not in seen:
            seen.add(code)
            results.append({
                "codigo": code,
                "foto_url": rel_url
            })
    return results

def parse_from_json(json_path: str):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

def download_and_bind_photo(item: dict, db_path: str):
    raw_code = str(item.get("codigo", "")).strip()
    rel_url = str(item.get("foto_url", "")).strip()
    
    if not raw_code or not rel_url:
        return None

    stripped_code = raw_code.lstrip("0")
    if not stripped_code:
        stripped_code = "0"

    full_url = rel_url if rel_url.startswith("http") else BASE_OFFICIAL_URL + rel_url
    
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    cur.execute(
        "SELECT id, codigo_interno, codigo_oficial, descripcion, imagen_url, es_foto_personalizada FROM activos WHERE codigo_oficial = ? OR codigo_oficial = ?",
        (raw_code, stripped_code)
    )
    row = cur.fetchone()
    
    if not row:
        con.close()
        return {"status": "not_found", "codigo": raw_code}

    activo_id, cod_int, cod_of, desc, current_img, es_personalizada = row

    # BLINDAJE: Si el activo ya tiene una foto tomada manualmente en el plantel, se respeta y no se sobreescribe
    if es_personalizada:
        con.close()
        return {"status": "skipped_personalizada", "codigo": raw_code, "activo_id": activo_id}

    dest_filename = f"activo_{activo_id}_{cod_int}.jpg"
    dest_path = os.path.join(UPLOADS_DIR, dest_filename)
    local_url = f"/uploads/{dest_filename}"

    # Si ya existe en disco y ya está vinculada en la base de datos, omitir completamente
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0 and current_img == local_url:
        con.close()
        return {"status": "already_exists", "codigo": raw_code, "activo_id": activo_id}

    # Descargar la imagen únicamente si no existe en disco o está corrupta (0 bytes)
    downloaded = False
    if not os.path.exists(dest_path) or os.path.getsize(dest_path) == 0:
        try:
            req = urllib.request.Request(
                full_url,
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp, open(dest_path, "wb") as out_f:
                out_f.write(resp.read())
            downloaded = True
        except Exception as e:
            con.close()
            return {"status": "download_error", "codigo": raw_code, "error": str(e)}

    # Actualizar base de datos
    cur.execute(
        "UPDATE activos SET imagen_url = ?, es_foto_personalizada = 0 WHERE id = ?",
        (local_url, activo_id)
    )
    con.commit()
    con.close()

    return {
        "status": "success",
        "activo_id": activo_id,
        "codigo_interno": cod_int,
        "codigo_oficial": cod_of,
        "descripcion": desc,
        "imagen_url": local_url,
        "downloaded": downloaded
    }

def main():
    parser = argparse.ArgumentParser(description="Importador masivo de fotos oficiales de D.G.")
    parser.add_argument("--html", default=None, help="Ruta al archivo HTML (ej. Inventario.html)")
    parser.add_argument("--json", default=None, help="Ruta al archivo JSON (ej. fotos_oficiales_cobach3.json)")
    parser.add_argument("--max-workers", type=int, default=8, help="Hilos concurrentes para descarga")
    args = parser.parse_args()

    items = []
    if args.json and os.path.exists(args.json):
        print(f"Cargando desde JSON: {args.json}")
        items = parse_from_json(args.json)
    elif args.html and os.path.exists(args.html):
        print(f"Cargando desde HTML: {args.html}")
        items = parse_from_html(args.html)
    else:
        # Por defecto buscar fotos_oficiales_cobach3.json o Inventario.html en BASE_DIR
        default_json = os.path.join(BASE_DIR, "fotos_oficiales_cobach3.json")
        default_html = os.path.join(BASE_DIR, "Inventario.html")
        if os.path.exists(default_json):
            print(f"Detectado archivo JSON predeterminado: {default_json}")
            items = parse_from_json(default_json)
        elif os.path.exists(default_html):
            print(f"Detectado archivo HTML predeterminado: {default_html}")
            items = parse_from_html(default_html)
        else:
            print("No se encontró ningún archivo HTML ni JSON para procesar.")
            return

    print(f"Se encontraron {len(items)} registros con fotografía para procesar.")
    if not items:
        return

    success_count = 0
    already_exists_count = 0
    skipped_personalizada_count = 0
    not_found_count = 0
    error_count = 0

    with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        futures = {executor.submit(download_and_bind_photo, it, DB_PATH): it for it in items}
        for future in as_completed(futures):
            res = future.result()
            if not res:
                continue
            status = res.get("status")
            if status == "success":
                success_count += 1
                if (success_count + already_exists_count) % 25 == 0 or (success_count + already_exists_count) == len(items):
                    print(f"  [Progreso] {success_count + already_exists_count}/{len(items)} registros procesados...")
            elif status == "already_exists":
                already_exists_count += 1
            elif status == "skipped_personalizada":
                skipped_personalizada_count += 1
            elif status == "not_found":
                not_found_count += 1
            elif status == "download_error":
                error_count += 1
                print(f"  [Error] Falló descarga para código {res['codigo']}: {res.get('error')}")

    print("\n--- RESUMEN DE IMPORTACIÓN ---")
    print(f"Nuevas descargadas y vinculadas: {success_count}")
    print(f"Ya existentes (omitidas de red): {already_exists_count}")
    if skipped_personalizada_count > 0:
        print(f"Protegidas (foto personalizada): {skipped_personalizada_count}")
    if not_found_count > 0:
        print(f"No encontrados en la BD:        {not_found_count}")
    if error_count > 0:
        print(f"Errores de descarga:            {error_count}")
    print("-------------------------------")

if __name__ == "__main__":
    main()

