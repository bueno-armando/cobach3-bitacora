import io
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models import Activo
from sqlalchemy import func

client = TestClient(app)

def test_api_activos_structure():
    res = client.get('/api/activos?limit=10')
    assert res.status_code == 200
    data = res.json()
    assert 'items' in data
    assert len(data['items']) > 0
    item = data['items'][0]
    required_keys = [
        'id', 'codigo_interno', 'codigo_oficial', 'origen',
        'estatus_etiqueta', 'estatus_activo', 'descripcion',
        'especificacion', 'marca', 'modelo', 'numero_serie',
        'categoria', 'ubicacion', 'resguardante', 'condicion',
        'condicion_dg', 'condicion_actual', 'imagen_url',
        'es_foto_personalizada', 'observaciones'
    ]
    for key in required_keys:
        assert key in item, f"Missing key: {key}"

def test_photo_shielding():
    db = SessionLocal()
    # Find a model with multiple items
    model_dup = (
        db.query(Activo.modelo, func.count(Activo.id))
        .filter(Activo.modelo.isnot(None), Activo.modelo != "")
        .group_by(Activo.modelo)
        .having(func.count(Activo.id) > 1)
        .first()
    )
    assert model_dup is not None
    shared_model = model_dup[0]
    assets = db.query(Activo).filter(Activo.modelo == shared_model).limit(2).all()
    a1, a2 = assets[0], assets[1]

    # 1x1 dummy PNG
    fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"

    try:
        # Step 1: Upload a custom photo for a1
        files1 = {"file": ("damaged_a1.png", fake_png, "image/png")}
        res1 = client.post(f"/api/activos/{a1.id}/imagen?propagate_model=false&es_personalizada=true", files=files1)
        assert res1.status_code == 200
        a1_img = res1.json()["imagen_url"]

        db.refresh(a1)
        assert a1.es_foto_personalizada is True
        assert a1.imagen_url == a1_img

        # Step 2: Upload a generic photo to a2, propagate to model without force_overwrite
        files2 = {"file": ("generic_model.png", fake_png, "image/png")}
        res2 = client.post(f"/api/activos/{a2.id}/imagen?propagate_model=true&force_overwrite=false&es_personalizada=false", files=files2)
        assert res2.status_code == 200

        db.refresh(a1)
        db.refresh(a2)

        # a2 received the new image
        assert a2.imagen_url is not None
        # a1 PRESERVED its custom image because es_foto_personalizada is True
        assert a1.imagen_url == a1_img, f"Protection failed! a1 got {a1.imagen_url} instead of {a1_img}"
        assert a1.es_foto_personalizada is True

    finally:
        # Clean up DB records and physical test files
        import os, glob
        client.delete(f"/api/activos/{a1.id}/imagen")
        client.delete(f"/api/activos/{a2.id}/imagen")
        for f in glob.glob("uploads/activo_*"):
            try:
                os.remove(f)
            except Exception:
                pass
        db.close()

if __name__ == "__main__":
    print("Running test_api_activos_structure...")
    test_api_activos_structure()
    print("Running test_photo_shielding...")
    test_photo_shielding()
    print("ALL TESTS PASSED SUCCESSFULLY!")

