from dotenv import load_dotenv
import os
from pymongo import MongoClient

load_dotenv()

client = MongoClient(os.getenv("MONGODB_URL", "mongodb://admin_user:Movate$20261@mongodb:27017/"))
mydb = client[os.getenv("MONGODB_NAME", "teamsapp")]