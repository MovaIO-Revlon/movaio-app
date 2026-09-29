from dotenv import load_dotenv
import os
from pymongo import MongoClient

load_dotenv()

client = MongoClient(os.getenv("DB_URL", "mongodb://localhost:27017/"))
mydb = client[os.getenv("DB_NAME", "MovaiO-Bot")]