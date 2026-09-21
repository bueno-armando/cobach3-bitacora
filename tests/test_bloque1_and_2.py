import io
import openpyxl
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models import Activo

def test_auto_code_generation_and_export():
    client = TestClient(app)

    # 1. Test POST /api/activos sin codigo_interno para GASTO
    payload_gasto = {
        "descripcion": "TEST ARTICULO GASTO AUTO",
        "origen": "GASTO",
        "condicion_actual": "Buena 61% - 80%",
        "estatus_operativo": "OPERATIVO",
        "codigo_interno": None
    }
    res_gasto = client.post("/api/activos", json=payload_gasto)
    assert res_gasto.status_code == 201, f"Error: {res_gasto.text}"
    data_gasto = res_gasto.json()
    assert data_gasto["codigo_interno"].startswith("PL3-GTO-"), f"Unexpected code: {data_gasto['codigo_interno']}"
    gasto_id = data_gasto["id"]

    # 2. Test POST /api/activos sin codigo_interno para CONTROL ADMINISTRATIVO
    payload_ca = {
        "descripcion": "TEST ARTICULO CA AUTO",
        "origen": "CONTROL ADMINISTRATIVO",
        "condicion_actual": "Buena 61% - 80%",
        "estatus_operativo": "OPERATIVO",
        "codigo_interno": None
    }
    res_ca = client.post("/api/activos", json=payload_ca)
    assert res_ca.status_code == 201, f"Error: {res_ca.text}"
    data_ca = res_ca.json()
    assert data_ca["codigo_interno"].startswith("PL3-CA-"), f"Unexpected code: {data_ca['codigo_interno']}"
    ca_id = data_ca["id"]

    # 3. Test Export Excel with custom columns: codigo_interno, descripcion, ubicacion
    res_exp = client.get("/api/export/excel?columnas=codigo_interno,descripcion,ubicacion")
    assert res_exp.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res_exp.headers["content-type"]
    wb = openpyxl.load_workbook(io.BytesIO(res_exp.content))
    ws = wb.active
    header_row = [cell.value for cell in ws[1]]
    assert header_row == ["Código Interno", "Descripción", "Ubicación"], f"Headers mismatch: {header_row}"

    # 4. Test Export Excel default columns
    res_exp_all = client.get("/api/export/excel")
    assert res_exp_all.status_code == 200
    wb_all = openpyxl.load_workbook(io.BytesIO(res_exp_all.content))
    ws_all = wb_all.active
    header_row_all = [cell.value for cell in ws_all[1]]
    assert len(header_row_all) == 19, f"Expected 19 columns, got {len(header_row_all)}"

    # Cleanup test items
    db = SessionLocal()
    try:
        db.query(Activo).filter(Activo.id.in_([gasto_id, ca_id])).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    print("TEST BLOQUE 1 & 2 PASSED COMPLETELY!")

if __name__ == "__main__":
    test_auto_code_generation_and_export()
