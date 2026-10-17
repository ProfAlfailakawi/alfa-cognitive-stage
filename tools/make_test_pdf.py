"""Write a small text PDF used by CI to test the PDF import path end to end."""
import sys
from pathlib import Path

from test_import_formats import text_pdf

out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/alfa-test.pdf")
out.write_bytes(text_pdf(4, "Slide"))
print(out)
