import pymongo
import ssl
import urllib.parse
from datetime import datetime
import os

# Connection parameters for your DocumentDB cluster
DOCDB_HOST = "labs-movateai-docdb.cluster-cee3adjmzwyg.us-east-1.docdb.amazonaws.com"
DOCDB_PORT = 27017
DOCDB_USERNAME = "movateaiuser"  # Your master username
DOCDB_PASSWORD = "MovateAI$2025"  # Replace with your actual password

def download_certificate():
    """
    Download the DocumentDB certificate if it doesn't exist
    """
    cert_file = "rds-ca-2019-root.pem"
    if not os.path.exists(cert_file):
        print("Downloading DocumentDB certificate...")
        try:
            import urllib.request
            urllib.request.urlretrieve(
                "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem",
                cert_file
            )
            print(f"Certificate downloaded: {cert_file}")
        except Exception as e:
            print(f"Error downloading certificate: {e}")
            print("Please download manually:")
            print("wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -O rds-ca-2019-root.pem")
            return None
    return cert_file

def connect_to_documentdb():
    """
    Connect to Amazon DocumentDB cluster with improved SSL handling
    """
    try:
        # Download certificate if needed
        cert_file = download_certificate()
        if not cert_file:
            return None
        
        # URL encode the username and password
        username = urllib.parse.quote_plus(DOCDB_USERNAME)
        password = urllib.parse.quote_plus(DOCDB_PASSWORD)
        
        # Connection string for DocumentDB
        connection_string = f"mongodb://{username}:{password}@{DOCDB_HOST}:{DOCDB_PORT}/?ssl=true&ssl_ca_certs={cert_file}&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"
        
        print(f"Connecting to DocumentDB...")
        print(f"Host: {DOCDB_HOST}")
        print(f"Port: {DOCDB_PORT}")
        print(f"Username: {DOCDB_USERNAME}")
        
        # Try different connection methods based on pymongo version
        try:
            # Method 1: Using connection string with SSL parameters
            client = pymongo.MongoClient(connection_string)
        except Exception as e1:
            print(f"Method 1 failed: {e1}")
            try:
                # Method 2: Using separate SSL parameters
                client = pymongo.MongoClient(
                    host=DOCDB_HOST,
                    port=DOCDB_PORT,
                    username=DOCDB_USERNAME,
                    password=DOCDB_PASSWORD,
                    ssl=True,
                    tlsCAFile=cert_file,  # Updated parameter name
                    replicaSet='rs0',
                    readPreference='secondaryPreferred',
                    retryWrites=False
                )
            except Exception as e2:
                print(f"Method 2 failed: {e2}")
                # Method 3: Basic connection without SSL verification (NOT recommended for production)
                print("Trying connection without SSL verification...")
                basic_connection_string = f"mongodb://{username}:{password}@{DOCDB_HOST}:{DOCDB_PORT}/?ssl=true&ssl_cert_reqs=CERT_NONE&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"
                client = pymongo.MongoClient(basic_connection_string)
        
        # Test the connection
        client.admin.command('ping')
        print("Successfully connected to DocumentDB!")
        
        # Print pymongo version for debugging
        print(f"PyMongo version: {pymongo.version}")
        
        return client
        
    except Exception as e:
        print(f"Error connecting to DocumentDB: {e}")
        print("\nTroubleshooting tips:")
        print("1. Verify your password is correct")
        print("2. Check if your IP is allowed in the security group")
        print("3. Ensure you're connected to the same VPC or have proper network access")
        print("4. Try updating pymongo: pip install --upgrade pymongo")
        return None

def test_basic_connection():
    """
    Test basic connection without SSL for debugging
    """
    try:
        username = urllib.parse.quote_plus(DOCDB_USERNAME)
        password = urllib.parse.quote_plus(DOCDB_PASSWORD)
        
        # Basic connection string without SSL
        connection_string = f"mongodb://{username}:{password}@{DOCDB_HOST}:{DOCDB_PORT}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"
        
        print("Testing basic connection (without SSL)...")
        client = pymongo.MongoClient(connection_string)
        client.admin.command('ping')
        print("Basic connection successful!")
        return client
        
    except Exception as e:
        print(f"Basic connection failed: {e}")
        return None

def create_database_and_collections(client):
    """
    Create a new database and collections with sample data
    """
    if not client:
        return
    
    try:
        # Create/access a database
        db_name = "sample_app_db"
        db = client[db_name]
        print(f"Working with database: {db_name}")
        
        # Create collections by inserting sample data
        
        # 1. Users collection
        users_collection = db['users']
        sample_users = [
            {
                "user_id": 1,
                "name": "John Doe",
                "email": "john.doe@example.com",
                "age": 30,
                "city": "New York",
                "created_at": datetime.now(),
                "status": "active"
            },
            {
                "user_id": 2,
                "name": "Jane Smith",
                "email": "jane.smith@example.com",
                "age": 25,
                "city": "San Francisco",
                "created_at": datetime.now(),
                "status": "active"
            }
        ]
        
        result = users_collection.insert_many(sample_users)
        print(f"Inserted {len(result.inserted_ids)} users")
        
        # 2. Products collection
        products_collection = db['products']
        sample_products = [
            {
                "product_id": 101,
                "name": "Laptop",
                "category": "Electronics",
                "price": 999.99,
                "in_stock": True,
                "created_at": datetime.now()
            },
            {
                "product_id": 102,
                "name": "Smartphone",
                "category": "Electronics",
                "price": 699.99,
                "in_stock": True,
                "created_at": datetime.now()
            }
        ]
        
        result = products_collection.insert_many(sample_products)
        print(f"Inserted {len(result.inserted_ids)} products")
        
        return db
        
    except Exception as e:
        print(f"Error creating database and collections: {e}")
        return None

def explore_created_data(db):
    """
    Explore the data we just created
    """
    if not db:
        return
    
    try:
        print("\n" + "="*50)
        print("EXPLORING CREATED DATA")
        print("="*50)
        
        # List collections in our database
        collections = db.list_collection_names()
        print(f"Collections in '{db.name}': {collections}")
        
        # Explore each collection
        for collection_name in collections:
            collection = db[collection_name]
            count = collection.count_documents({})
            print(f"\n--- {collection_name.upper()} Collection ({count} documents) ---")
            
            # Show all documents from each collection
            documents = collection.find()
            for i, doc in enumerate(documents, 1):
                print(f"Document {i}: {doc}")
        
    except Exception as e:
        print(f"Error exploring data: {e}")

def main():
    """
    Main function with improved error handling
    """
    print("Setting up DocumentDB database and collections...")
    print(f"PyMongo version: {pymongo.version}")
    
    # Try to connect to DocumentDB
    client = connect_to_documentdb()
    
    # If SSL connection fails, try basic connection for testing
    if not client:
        print("\nSSL connection failed. Trying basic connection for testing...")
        client = test_basic_connection()
    
    if client:
        # Create database and collections with sample data
        db = create_database_and_collections(client)
        
        if db:
            # Explore the created data
            explore_created_data(db)
        
        # Close the connection
        client.close()
        print("\nConnection closed successfully.")
    else:
        print("\nFailed to connect to DocumentDB.")
        print("\nPlease check:")
        print("1. Your DocumentDB password")
        print("2. Network connectivity (VPC, Security Groups)")
        print("3. PyMongo version: pip install --upgrade pymongo")

if __name__ == "__main__":
    main()
