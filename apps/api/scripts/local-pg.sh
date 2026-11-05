#!/usr/bin/env bash
# Levanta un PostgreSQL propio del usuario (sin sudo) para desarrollo local.
#
# El PostgreSQL del sistema en Fedora usa autenticación `ident` en TCP y el
# usuario del proyecto no puede crear tablas en el esquema `public`. Este
# script crea un clúster aislado en ~/.local/share/postulia/pgdata, escucha en
# el puerto 5433 con autenticación `trust` (solo local) y deja la base
# `postulia` lista para `npm run db:migrate`.
set -euo pipefail

PGDATA="${PGDATA:-$HOME/.local/share/postulia/pgdata}"
PGPORT="${PGPORT:-5433}"
PGLOG="${PGLOG:-$HOME/.local/share/postulia/postgres.log}"
PGDATABASE="${PGDATABASE:-postulia}"

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      echo "Inicializando clúster en $PGDATA…"
      mkdir -p "$(dirname "$PGDATA")"
      initdb -D "$PGDATA" -U "$(whoami)" --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
    fi

    if pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then
      echo "PostgreSQL ya está corriendo en el puerto $PGPORT."
    else
      echo "Arrancando PostgreSQL en el puerto $PGPORT…"
      pg_ctl -D "$PGDATA" -l "$PGLOG" -o "-p $PGPORT -k /tmp" start >/dev/null
      # Espera breve a que acepte conexiones.
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1 && break
        sleep 0.5
      done
    fi

    if ! psql -h localhost -p "$PGPORT" -U "$(whoami)" -d "$PGDATABASE" -c "SELECT 1" >/dev/null 2>&1; then
      echo "Creando base de datos $PGDATABASE…"
      createdb -h localhost -p "$PGPORT" -U "$(whoami)" "$PGDATABASE"
    fi

    echo "Listo: postgresql://$(whoami)@localhost:$PGPORT/$PGDATABASE"
    ;;
  stop)
    pg_ctl -D "$PGDATA" stop
    ;;
  status)
    pg_isready -h localhost -p "$PGPORT"
    ;;
  *)
    echo "Uso: $0 [start|stop|status]" >&2
    exit 1
    ;;
esac
