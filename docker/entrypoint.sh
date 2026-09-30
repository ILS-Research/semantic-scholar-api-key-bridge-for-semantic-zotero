#!/bin/sh
# Trusts extra CAs mounted to /usr/local/share/ca-certificates/extra/*.crt (e.g. an internal CA
# signing the OIDC provider) in addition to Node's built-in ones.
set -e
extra=/tmp/extra-ca.pem
: > "$extra"
for crt in /usr/local/share/ca-certificates/extra/*.crt; do
	[ -f "$crt" ] && cat "$crt" >> "$extra" && echo >> "$extra"
done
[ -s "$extra" ] && export NODE_EXTRA_CA_CERTS="$extra"
exec node build
