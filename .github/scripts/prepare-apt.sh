#!/usr/bin/env bash
set -euo pipefail

# Hosted runners may use a mirror+file source that selects the Azure HTTP mirror.
# Slow downloads there have exhausted the CI job before browser tests can start.
# Cover both direct sources and mirror lists, preserving suites and signing keys.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources /etc/apt/apt-mirrors*.txt; do
  [[ -f "$source" ]] || continue
  sudo sed -i \
    -e 's|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
    -e 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
    -e 's|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' \
    "$source"
done

printf '%s\n' \
  'Acquire::Retries "3";' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  | sudo tee /etc/apt/apt.conf.d/80anim8-network >/dev/null
