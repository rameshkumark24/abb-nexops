import os

# Isolate the test database environment before any modules are loaded
os.environ["DATABASE_URL"] = "sqlite:///./test_tmp.db"
