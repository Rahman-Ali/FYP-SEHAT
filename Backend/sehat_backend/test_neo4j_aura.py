from neo4j import GraphDatabase

driver = GraphDatabase.driver(
    "bolt://localhost:7687",
    auth=("neo4j", "12345678")
)

def test():
    with driver.session() as session:
        result = session.run("RETURN 'Neo4j Connected Successfully' AS msg")
        for record in result:
            print(record["msg"])

test()
driver.close()