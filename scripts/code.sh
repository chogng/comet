#!/usr/bin/env bash

set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(realpath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
fi

function code() {
	cd "$ROOT"

	if [[ "$OSTYPE" == "darwin"* ]]; then
		currentLimit=$(ulimit -n)
		if [[ "$currentLimit" =~ ^[0-9]+$ && "$currentLimit" -lt 4096 ]]; then
			ulimit -n 4096
		fi
	fi

	exec node "$ROOT/node_modules/tsx/dist/cli.mjs" "$ROOT/build/lib/devDesktop.ts" "$@"
}

code "$@"
