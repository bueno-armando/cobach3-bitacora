import os
import uvicorn
import backend.models
from backend.database import engine, Base
from backend.main import app

# Ensure all database tables exist
Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)

