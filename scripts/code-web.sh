#!/usr/bin/env bash

set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(realpath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
fi

cd "$ROOT"

webPort=5173
arguments=("$@")

for ((index = 0; index < ${#arguments[@]}; index++)); do
	case "${arguments[index]}" in
		--port)
			index=$((index + 1))
			webPort="${arguments[index]}"
			;;
		--port=*)
			webPort="${arguments[index]#--port=}"
			;;
	esac
done

webUrl="http://127.0.0.1:${webPort}/"

if curl --fail --silent --max-time 2 "$webUrl" | grep --fixed-strings --quiet '<title>Comet Studio</title>'; then
	listenerPids=()
	while IFS= read -r listenerPid; do
		if [[ -n "$listenerPid" ]]; then
			listenerPids+=("$listenerPid")
		fi
	done < <(lsof -nP -t -iTCP:"$webPort" -sTCP:LISTEN 2>/dev/null || true)

	if [[ ${#listenerPids[@]} -eq 0 ]]; then
		echo "Unable to identify the Comet Studio Web process listening on $webUrl" >&2
		exit 1
	fi

	for listenerPid in "${listenerPids[@]}"; do
		listenerCwd=$(lsof -a -p "$listenerPid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
		if [[ "$listenerCwd" != "$ROOT" ]]; then
			echo "Refusing to stop process $listenerPid because it is not running from $ROOT" >&2
			exit 1
		fi
	done

	echo "Stopping existing Comet Studio Web server at $webUrl"
	kill "${listenerPids[@]}"

	for ((attempt = 0; attempt < 50; attempt++)); do
		if ! lsof -nP -iTCP:"$webPort" -sTCP:LISTEN >/dev/null 2>&1; then
			break
		fi

		sleep 0.1
	done

	if lsof -nP -iTCP:"$webPort" -sTCP:LISTEN >/dev/null 2>&1; then
		echo "Forcing existing Comet Studio Web server to stop"
		kill -KILL "${listenerPids[@]}"

		for ((attempt = 0; attempt < 50; attempt++)); do
			if ! lsof -nP -iTCP:"$webPort" -sTCP:LISTEN >/dev/null 2>&1; then
				break
			fi

			sleep 0.1
		done

		if lsof -nP -iTCP:"$webPort" -sTCP:LISTEN >/dev/null 2>&1; then
			echo "Unable to stop the existing Comet Studio Web server at $webUrl" >&2
			exit 1
		fi
	fi
fi

exec node "$ROOT/node_modules/vite/bin/vite.js" --config "$ROOT/vite.web.config.ts" "$@"
