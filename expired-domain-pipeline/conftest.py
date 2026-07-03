# Đảm bảo project root nằm trên sys.path để `import pipeline` chạy được khi pytest.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
