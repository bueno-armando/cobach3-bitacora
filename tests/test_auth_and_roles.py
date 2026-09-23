from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models import Activo, Usuario


def test_auth_and_role_permissions():
    with TestClient(app) as client:
        db = SessionLocal()
        initial_activos_count = db.query(Activo).count()
        db.close()

        assert initial_activos_count == 1406, f"Expected 1406 initial assets, found {initial_activos_count}"

        # 1. Test incorrect login
        res_bad = client.post("/api/auth/login", json={"username": "admin", "password": "WrongPassword"})
        assert res_bad.status_code == 401, f"Expected 401 for bad login, got {res_bad.status_code}"

        # 2. Test successful logins
        res_admin = client.post("/api/auth/login", json={"username": "admin", "password": "Cobach3#Admin"})
        assert res_admin.status_code == 200
        token_admin = res_admin.json()["access_token"]
        headers_admin = {"Authorization": f"Bearer {token_admin}"}

        res_resguardo = client.post("/api/auth/login", json={"username": "resguardo", "password": "Cobach3#Resguardo"})
        assert res_resguardo.status_code == 200
        token_resguardo = res_resguardo.json()["access_token"]
        headers_resguardo = {"Authorization": f"Bearer {token_resguardo}"}

        res_consulta = client.post("/api/auth/login", json={"username": "consulta", "password": "Cobach3#Consulta"})
        assert res_consulta.status_code == 200
        token_consulta = res_consulta.json()["access_token"]
        headers_consulta = {"Authorization": f"Bearer {token_consulta}"}

        # 3. Test /api/auth/me
        me_resp = client.get("/api/auth/me", headers=headers_admin)
        assert me_resp.status_code == 200
        assert me_resp.json()["rol"] == "admin"

        me_resp_resg = client.get("/api/auth/me", headers=headers_resguardo)
        assert me_resp_resg.status_code == 200
        assert me_resp_resg.json()["rol"] == "resguardo"

        # 4. Test unauthenticated request blocked
        res_no_auth = client.get("/api/activos")
        assert res_no_auth.status_code == 401

        # 5. Test consulta role: Can read, cannot write
        res_read = client.get("/api/activos", headers=headers_consulta)
        assert res_read.status_code == 200

        res_stats = client.get("/api/stats", headers=headers_consulta)
        assert res_stats.status_code == 200

        res_forbidden_create = client.post(
            "/api/activos",
            json={"descripcion": "TEST ITEM CONSULTA", "origen": "GASTO"},
            headers=headers_consulta
        )
        assert res_forbidden_create.status_code == 403

        # 6. Test resguardo role permissions with cleanup guarantee
        created_resguardo_id = None
        created_admin_id = None
        try:
            # resguardo CAN create assets
            res_create_resguardo = client.post(
                "/api/activos",
                json={
                    "descripcion": "TEST BIEN RESGUARDO",
                    "origen": "GASTO",
                    "condicion_actual": "Buena 61% - 80%"
                },
                headers=headers_resguardo
            )
            assert res_create_resguardo.status_code == 201, f"Failed create resguardo: {res_create_resguardo.text}"
            created_resguardo_id = res_create_resguardo.json()["id"]

            # resguardo CANNOT delete assets
            res_delete_denied = client.delete(
                f"/api/activos/{created_resguardo_id}",
                headers=headers_resguardo
            )
            assert res_delete_denied.status_code == 403

            # resguardo CANNOT assign official green label
            res_tag_denied = client.post(
                f"/api/activos/{created_resguardo_id}/asignar-etiqueta",
                json={"codigo_oficial": "ETIQ-TEST-999"},
                headers=headers_resguardo
            )
            assert res_tag_denied.status_code == 403

            # resguardo CAN update condition and report desuso
            res_patch_cond = client.patch(
                f"/api/activos/{created_resguardo_id}/condicion",
                json={
                    "condicion_actual": "Mala / Chatarra 0-40%",
                    "nuevo_estatus": "EN_DESUSO",
                    "observaciones": "Equipo con tarjeta madre dañada irreversible"
                },
                headers=headers_resguardo
            )
            assert res_patch_cond.status_code == 200
            cond_data = res_patch_cond.json()
            assert cond_data["condicion_actual"] == "Mala / Chatarra 0-40%"
            assert cond_data["estatus_activo"] == "EN_DESUSO"

            # resguardo CAN update operational status directly
            res_patch_status = client.patch(
                f"/api/activos/{created_resguardo_id}/estatus-operativo",
                json={
                    "estatus": "EN_REPARACION",
                    "motivo": "Enviado a soporte técnico"
                },
                headers=headers_resguardo
            )
            assert res_patch_status.status_code == 200
            assert res_patch_status.json()["estatus_activo"] == "EN_REPARACION"

            # 7. Test admin role permissions
            # admin can create asset
            res_create_admin = client.post(
                "/api/activos",
                json={
                    "descripcion": "TEST BIEN ADMIN",
                    "origen": "CONTROL ADMINISTRATIVO"
                },
                headers=headers_admin
            )
            assert res_create_admin.status_code == 201
            created_admin_id = res_create_admin.json()["id"]

            # admin can update asset
            res_update_admin = client.put(
                f"/api/activos/{created_admin_id}",
                json={"descripcion": "TEST BIEN ADMIN MODIFICADO"},
                headers=headers_admin
            )
            assert res_update_admin.status_code == 200
            assert res_update_admin.json()["descripcion"] == "TEST BIEN ADMIN MODIFICADO"

        finally:
            # Strict cleanup to leave database completely clean
            cleanup_db = SessionLocal()
            try:
                if created_resguardo_id:
                    obj1 = cleanup_db.query(Activo).filter(Activo.id == created_resguardo_id).first()
                    if obj1:
                        cleanup_db.delete(obj1)
                if created_admin_id:
                    obj2 = cleanup_db.query(Activo).filter(Activo.id == created_admin_id).first()
                    if obj2:
                        cleanup_db.delete(obj2)
                cleanup_db.commit()
            finally:
                cleanup_db.close()

        # Final DB count check: must be exactly 1406
        final_db = SessionLocal()
        final_count = final_db.query(Activo).count()
        final_db.close()
        assert final_count == 1406, f"Database has {final_count} assets after test, expected 1406"
        print("ALL AUTH AND RBAC TESTS PASSED SUCCESSFULLY! Database count: 1406")


if __name__ == "__main__":
    test_auth_and_role_permissions()
