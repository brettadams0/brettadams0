#!/usr/bin/env bash
# Stands in for `claude` in tests: shows the dev-channels warning, waits for a
# key, records it, then shows a ready prompt.
echo "WARNING: Loading development channels"
echo " ❯ 1. I am using this for local development"
echo "   2. Exit"
IFS= read -rsn1 k
echo "key:$k args:$*" > "$FAKE_CLAUDE_LOG"
clear
echo "> "
echo "  ? for shortcuts"
sleep 600
