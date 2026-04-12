from neo4j import GraphDatabase


URI = "neo4j+s://910fb98b.databases.neo4j.io"
AUTH = ("neo4j", "wQ5-ocxghZZxla3JzUA2_3q9vVL5_mnxd-OvIrl_oF4")

try:
    print("Connecting to Neo4j...")
    with GraphDatabase.driver(URI, auth=AUTH) as driver:
        driver.verify_connectivity()
        print("✅ SUCCESS: Connection established!")
except Exception as e:
    print(f"FAILED: {e}")