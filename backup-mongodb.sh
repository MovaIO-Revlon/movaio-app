#!/bin/bash
# Backup MongoDB data from the Docker container named "mongodb".
# Usage:
#   ./backup-mongodb.sh [-c mongo-container] [-d database] [-o output-dir] [-u username] [-p password] [-a auth-db]
# Example:
#   ./backup-mongodb.sh -o ./mongo-backups -d movate_ai_infusion -u admin_user -p "Movate\$20261" -a admin

set -euo pipefail

CONTAINER_NAME="mongodb"
OUTPUT_DIR="./mongo-backups"
DB_NAME=""
USERNAME=""
PASSWORD=""
AUTH_DB="admin"

print_usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  -c container-name   MongoDB Docker container name (default: mongodb)
  -d database         Database name to back up (default: all databases)
  -o output-dir       Host output directory for backup files (default: ./mongo-backups)
  -u username         MongoDB username for authentication
  -p password         MongoDB password for authentication
  -a auth-db          Authentication database (default: admin)
  -h                  Show this help message and exit
EOF
}

while getopts ":c:d:o:u:p:a:h" opt; do
  case "$opt" in
    c) CONTAINER_NAME="$OPTARG" ;;
    d) DB_NAME="$OPTARG" ;;
    o) OUTPUT_DIR="$OPTARG" ;;
    u) USERNAME="$OPTARG" ;;
    p) PASSWORD="$OPTARG" ;;
    a) AUTH_DB="$OPTARG" ;;
    h)
      print_usage
      exit 0
      ;;
    *)
      print_usage
      exit 1
      ;;
  esac
done

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
TMP_DIR="mongo-backup-$TIMESTAMP"
CONTAINER_TMP_DIR="/tmp/$TMP_DIR"
HOST_OUTPUT_PATH="$OUTPUT_DIR/$TMP_DIR"

mkdir -p "$OUTPUT_DIR"

AUTH_ARGS=""
if [[ -n "$USERNAME" ]]; then
  AUTH_ARGS="--username=$USERNAME --password=$PASSWORD --authenticationDatabase=$AUTH_DB"
fi

DB_ARG=""
if [[ -n "$DB_NAME" ]]; then
  DB_ARG="--db=$DB_NAME"
fi

echo "Starting MongoDB backup from container '$CONTAINER_NAME'..."

docker exec "$CONTAINER_NAME" bash -lc "mkdir -p '$CONTAINER_TMP_DIR' && mongodump --host localhost:27017 $AUTH_ARGS $DB_ARG --out '$CONTAINER_TMP_DIR'"

echo "Copying backup from container to host directory '$HOST_OUTPUT_PATH'..."
mkdir -p "$HOST_OUTPUT_PATH"
docker cp "$CONTAINER_NAME:$CONTAINER_TMP_DIR/." "$HOST_OUTPUT_PATH/"

#echo "Cleaning temporary container backup directory..."
#docker exec "$CONTAINER_NAME" rm -rf "$CONTAINER_TMP_DIR"

echo "MongoDB backup completed successfully."
echo "Backup directory: $HOST_OUTPUT_PATH"
