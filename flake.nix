{
  description = "mux dev environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        servicesUp = pkgs.writeShellScriptBin "services-up" ''
          set -e
          mkdir -p "$PGDATA" "$REDIS_DATA"
          if [ ! -f "$PGDATA/PG_VERSION" ]; then
            initdb -U postgres --auth=trust -D "$PGDATA" >/dev/null
            echo "unix_socket_directories = '$PGDATA'" >> "$PGDATA/postgresql.conf"
          fi
          pg_ctl -D "$PGDATA" -l "$PGDATA/postgres.log" -o "-p 5432" start || true
          createdb -h localhost -U postgres mux 2>/dev/null || true
          redis-server --daemonize yes --dir "$REDIS_DATA" --port 6379 \
            --pidfile "$REDIS_DATA/redis.pid" --logfile "$REDIS_DATA/redis.log" >/dev/null
          echo "postgres :5432, redis :6379 running"
        '';

        servicesDown = pkgs.writeShellScriptBin "services-down" ''
          pg_ctl -D "$PGDATA" stop || true
          redis-cli -p 6379 shutdown nosave || true
        '';
      in {
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.bun pkgs.postgresql_17 pkgs.redis servicesUp servicesDown ];
          shellHook = ''
            export PGDATA="$PWD/.data/postgres"
            export REDIS_DATA="$PWD/.data/redis"
            export DATABASE_URL="postgres://postgres@localhost:5432/mux"
            export REDIS_URL="redis://localhost:6379"
            echo "run services-up / services-down to manage postgres + redis"
          '';
        };
      });
}
