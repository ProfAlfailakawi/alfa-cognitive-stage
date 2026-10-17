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
echo "افتح http://localhost:4173/#presenter"
echo "رمز المحاضر يظهر أدناه؛ لا تشاركه مع الطلبة."
(sleep 2; open "http://localhost:4173/#presenter" >/dev/null 2>&1) &
node server/server.mjs
