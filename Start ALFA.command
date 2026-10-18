#!/bin/zsh
# Double-click launcher for macOS, run from this repository directory.
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/LibreOffice.app/Contents/MacOS:$PATH"
echo "ALFA Cognitive Stage — macOS"
if ! command -v node >/dev/null; then
  echo "Node.js 22 أو أحدث غير موجود. يرجى تثبيته مرة واحدة."
  read "?اضغط Enter لإنهاء التشغيل..."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "يرجى تحديث Node.js إلى الإصدار 22 أو أحدث."
  read "?اضغط Enter لإنهاء التشغيل..."
  exit 1
fi

# Keep lecture-import Python packages isolated from macOS/Homebrew Python. The
# server and the installer always use this exact environment.
PYTHON_ENV="$PWD/.venv"
if [[ ! -x "$PYTHON_ENV/bin/python" ]] || ! "$PYTHON_ENV/bin/python" -c 'import pptx, lxml, PIL' >/dev/null 2>&1; then
  echo "تجهيز أدوات استيراد المحاضرات تلقائياً (مرة واحدة)..."
  python3 -m venv "$PYTHON_ENV" || {
    echo "تعذر إنشاء بيئة Python. ثبّت Python 3 من python.org أو Homebrew ثم أعد التشغيل."
    read "?اضغط Enter لإنهاء التشغيل..."
    exit 1
  }
  "$PYTHON_ENV/bin/python" -m pip install --upgrade pip || exit 1
  "$PYTHON_ENV/bin/python" -m pip install python-pptx lxml Pillow || {
    echo "تعذر تجهيز مكتبات Python. تحقق من اتصال الإنترنت ثم أعد فتح Start ALFA.command."
    read "?اضغط Enter لإنهاء التشغيل..."
    exit 1
  }
fi
export ALFA_PYTHON="$PYTHON_ENV/bin/python"
echo "افتح http://localhost:4173/#presenter"
echo "رمز المحاضر يظهر أدناه؛ لا تشاركه مع الطلبة."
(sleep 2; open "http://localhost:4173/#presenter" >/dev/null 2>&1) &
node server/server.mjs
