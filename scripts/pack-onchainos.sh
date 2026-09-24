#!/bin/sh
# Prints a base64 tarball of the local onchainos login. Paste it into the host secret.
# Do not commit the output.
set -eu
tar -C "$HOME/.onchainos" -czf - \
  session.json keyring.enc machine-identity wallets.json \
  | base64 | tr -d '\n'
echo
