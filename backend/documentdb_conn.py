import pymongo
import sys
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

def connect_to_documentdb():
    """
    Connect to AWS DocumentDB and create a new database
    """
    
    # DocumentDB connection parameters
    # Replace these with your actual cluster details
    DOCDB_HOST = "labs-internal-movateai-docdb.cluster-cee3adjmzwyg.us-east-1.docdb.amazonaws.com"
    DOCDB_PORT = 27017
    USERNAME = "movateaiuser"
    PASSWORD = "MovateAI$2025"
    DATABASE_NAME = "master"
    
    # Connection string for TLS-enabled cluster (recommended)
    connection_string = f"mongodb://{USERNAME}:{PASSWORD}@{DOCDB_HOST}:{DOCDB_PORT}/?tls=true&tlsCAFile=global-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"
    
    try:
        # Create MongoDB client
        print("Connecting to DocumentDB...")
        client = MongoClient(connection_string)
        
        # Test the connection
        client.admin.command('ping')
        print("Successfully connected to DocumentDB!")
        
        # Create/access a new database
        db = client[DATABASE_NAME]
        print(f"Database '{DATABASE_NAME}' created/accessed successfully!")
        
        # Create a collection and insert a sample document to initialize the database
        collection_name = "sample_collection"
        collection = db[collection_name]
        
        # Insert a sample document
        sample_document = {
            "message": "Hello from AWS DocumentDB!",
            "created_at": "2025-10-22",
            "type": "initialization"
        }
        
        result = collection.insert_one(sample_document)
        print(f"Sample document inserted with ID: {result.inserted_id}")
        
        # List all databases to confirm creation
        print("\nAvailable databases:")
        for db_name in client.list_database_names():
            print(f"- {db_name}")
        
        # List collections in the new database
        print(f"\nCollections in '{DATABASE_NAME}':")
        for collection_name in db.list_collection_names():
            print(f"- {collection_name}")
        
        return client, db
        
    except ConnectionFailure as e:
        print(f"Failed to connect to DocumentDB: {e}")
        return None, None
    except OperationFailure as e:
        print(f"Authentication failed: {e}")
        return None, None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None, None

def perform_basic_operations(db):
    """
    Perform basic database operations
    """
    if db is None:
        return
    
    collection = db["sample_collection"]
    
    # Insert multiple documents
    documents = [
        {"name": "Alice", "age": 30, "city": "New York"},
        {"name": "Bob", "age": 25, "city": "San Francisco"},
        {"name": "Charlie", "age": 35, "city": "Seattle"}
    ]
    
    result = collection.insert_many(documents)
    print(f"\nInserted {len(result.inserted_ids)} documents")
    
    # Query documents
    print("\nAll documents in collection:")
    for doc in collection.find():
        print(doc)
    
    # Query with filter
    print("\nDocuments where age > 28:")
    for doc in collection.find({"age": {"$gt": 28}}):
        print(doc)

def main():
    """
    Main function to demonstrate DocumentDB connection and operations
    """
    # Connect to DocumentDB and create database
    client, db = connect_to_documentdb()
    
    if client is not None and db is not None:
        # Perform some basic operations
        perform_basic_operations(db)
        
        # Close the connection
        client.close()
        print("\nConnection closed successfully!")
    else:
        print("Failed to establish connection to DocumentDB")

if __name__ == "__main__":
    main()
