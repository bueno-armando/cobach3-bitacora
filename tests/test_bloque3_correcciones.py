import io
import openpyxl
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models import Activo

client = TestClient(app)

def get_admin_headers():
    res = client.post("/api/auth/login", json={"username": "admin", "password": "Cobach3#Admin"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def get_resguardo_headers():
    res = client.post("/api/auth/login", json={"username": "resguardo", "password": "Cobach3#Resguardo"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_batch_activos():
    headers = get_admin_headers()
    db = SessionLocal()
    try:
        sample = db.query(Activo.id).limit(5).all()
        ids = [s[0] for s in sample]
        res = client.post("/api/activos/batch", json={"ids": ids}, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert len(data) == len(ids)
        for item in data:
            assert item["id"] in ids
            assert "tiene_discrepancia_dg" in item
            assert "condicion_actual" in item
    finally:
        db.close()

def test_condicion_filters():
    headers = get_admin_headers()
    for cond in ["Excelente", "Buena", "Mala / Regular", "Pésima"]:
        res = client.get(f"/api/activos?condicion={cond}&limit=10", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        for item in data["items"]:
            cond_val = item.get("condicion_actual") or item.get("condicion") or ""
            c_low = cond_val.lower()
            if "exce" in cond.lower():
                assert "exce" in c_low
            elif "pesim" in cond.lower() or "pésim" in cond.lower():
                assert "pesim" in c_low or "pésim" in c_low
            elif "mala" in cond.lower() or "regular" in cond.lower():
                assert "mala" in c_low or "regular" in c_low
            elif "buen" in cond.lower():
                assert "buen" in c_low

def test_discrepancias_filter():
    headers = get_admin_headers()
    res = client.get("/api/activos?discrepancias=true&limit=50", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert data["total"] > 0
    for item in data["items"]:
        assert item["origen"] == "DIRECCION GENERAL"
        assert item["tiene_discrepancia_dg"] is True

def test_excel_export_formatting_and_comentarios():
    headers = get_admin_headers()
    res = client.get("/api/export/excel?discrepancias=true&scope=DISCREPANCIAS_DG", headers=headers)
    assert res.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res.headers["content-type"]
    
    # Inspect workbook
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    ws = wb.active
    assert ws is not None

    # Verify header has 'Comentarios' and NOT 'Observaciones'
    headers_row = [cell.value for cell in ws[1]]
    assert "Comentarios" in headers_row
    assert "Observaciones" not in headers_row

    # Check column widths capped to max 42
    for col_letter, col_dim in ws.column_dimensions.items():
        if col_dim.width is not None:
            assert col_dim.width <= 45

    # Check wrap text on cells
    sample_cell = ws.cell(row=2, column=1)
    if ws.max_row >= 2:
        assert sample_cell.alignment.wrap_text is True

def test_excel_import_rbac_and_import():
    # 1. Resguardo cannot import
    resg_headers = get_resguardo_headers()
    fake_excel = io.BytesIO()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Gasto"
    ws.append(["No.", "DESCRIPCIÓN", "MARCA", "MODELO", "SERIE", "CONDICIÓN", "UBICACIÓN", "COMENTARIOS"])
    ws.append([1, "PROBADOR DE PUNTAS TEST AUTO", "STEREN", "PT-100", "SN-TEST-UNIQUE-99999", "Excelente", "Taller de Mantenimiento", "Prueba temporal"])
    wb.save(fake_excel)
    fake_excel.seek(0)

    res = client.post(
        "/api/import/excel",
        data={"origen": "GASTO"},
        files={"file": ("test_gasto.xlsx", fake_excel.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=resg_headers
    )
    assert res.status_code == 403

    # 2. Admin can import
    admin_headers = get_admin_headers()
    fake_excel.seek(0)
    db = SessionLocal()
    initial_count = db.query(Activo).count()
    db.close()

    try:
        res = client.post(
            "/api/import/excel",
            data={"origen": "GASTO"},
            files={"file": ("test_gasto.xlsx", fake_excel.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=admin_headers
        )
        assert res.status_code == 200
        data = res.json()
        assert data["creados"] == 1
        assert data["omitidos"] == 0

        # Try importing same file again -> should be duplicate
        fake_excel.seek(0)
        res_dup = client.post(
            "/api/import/excel",
            data={"origen": "GASTO"},
            files={"file": ("test_gasto.xlsx", fake_excel.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=admin_headers
        )
        assert res_dup.status_code == 200
        data_dup = res_dup.json()
        assert data_dup["creados"] == 0
        assert data_dup["omitidos"] == 1
    finally:
        # Clean up test asset so count remains exactly initial_count
        db = SessionLocal()
        test_asset = db.query(Activo).filter(Activo.numero_serie == "SN-TEST-UNIQUE-99999").first()
        if test_asset:
            db.delete(test_asset)
            db.commit()
        final_count = db.query(Activo).count()
        db.close()
        assert final_count == initial_count
