// MongoDB initialization script
db = db.getSiblingDB('movate_ai_infusion');

// Create UserManagement collection and insert data
db.UserManagement.insertOne({
  "_id": ObjectId("686d331ea59d79e428b3868f"),
  "FirstName": "Gobu",
  "LastName": "Durai", 
  "Email": "gobu.durairasu@movate.com",
  "Salt": "T2LbHqQsFHx3Sw==",
  "Password": "RDRVsZ6ChTM2ErkwFKaJsLv7uIIb84MoBeQ+Mc5cdEE=",
  "RoleId": 0,
  "IsActive": true,
  "CreatedBy": "Gobu.Durairasu@movate.com",
  "CreatedDate": new Date("2025-07-08T15:02:54.592Z"),
  "UpdatedDate": new Date("2025-09-18T13:37:37.184Z"),
  "IsDelete": false,
  "TeamId": 1,
  "Avatar": "assets/userprofile/Luthuf_Profile-7ae8b292-ca934107.png",
  "UpdatedBy": "gobu.durairasu@movate.com"
});

print("UserManagement collection initialized");