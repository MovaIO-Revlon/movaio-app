#!/bin/bash
# Import all MongoDB collections

# Copy all JSON files to container
docker cp mongo_db_collections/. mongodb:/tmp/

# Import each collection
docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection UserManagement \
  --jsonArray \
  --file /tmp/UserManagement.json

docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection RoleManagement \
  --jsonArray \
  --file /tmp/RoleManagement.json

docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection RolePermissions \
  --jsonArray \
  --file /tmp/RolePermissions.json

docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection TeamManagement \
  --jsonArray \
  --file /tmp/TeamManagement.json

docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection AgentRoleMasterCollection \
  --jsonArray \
  --file /tmp/AgentRoleMasterCollection.json

docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection AgentTypeMasterCollection \
  --jsonArray \
  --file /tmp/AgentTypeMasterCollection.json

docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection ProjectManagement \
  --jsonArray \
  --file /tmp/ProjectManagement.json
  
docker exec mongodb mongoimport \
  --host localhost:27017 \
  --username admin_user \
  --password "MovateiO\$20261" \
  --authenticationDatabase admin \
  --db movate_ai_infusion \
  --collection PageConfiguration \
  --jsonArray \
  --file /tmp/PageConfiguration.json
    
echo "All MongoDB collections imported successfully"
