# ontomato-python:2
from query_runtime import parameters, update
update("contract_person", {"age": parameters["age"]}, {"field":"id","operator":"=","value":parameters["id"]})
