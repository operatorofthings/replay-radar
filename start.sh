#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
if [ -x .runtime/bin/node ]; then export PATH="$PWD/.runtime/bin:$PATH"; fi
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -d dist ]; then npm run build; fi
exec npm start
