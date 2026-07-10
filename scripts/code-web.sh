#!/usr/bin/env bash

set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(realpath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
fi

cd "$ROOT"

exec node "$ROOT/node_modules/vite/bin/vite.js" --config "$ROOT/vite.web.config.ts" "$@"
