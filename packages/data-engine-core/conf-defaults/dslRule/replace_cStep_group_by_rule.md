		6.3.2 If a non-bucket type field needs a group aggregation operation, the aggregation operation must be defined according to the following logic
   
		- When there is a function field, it indicates that an aggregate calculation is needed on this attribute field; the aggregate calculation supports avg for the average, count for counting, min for the minimum, max for the maximum and sum for summation, and it aggregates the entire result set

		- A step with exactly one object and no relationship may aggregate or group its rows in that same step without first saving a temporary table. A step with two or more objects must not aggregate or group. Join the objects and project their detail rows into a temporary table in the first step, then read that table and aggregate or group in the second step.

One step with one object

```json
{"problem":"Count people","answer":{"steps":[
  {"graph":{"patterns":[{"objects":[{"class":"person","variable":"p","idx":0}]}]},
   "output":{"to_user":true,"fields":[{"variable":"p","field":"id","function":"count","as":"person_count"}]}}
]}}
```

Two steps with related objects

```json
{"problem":"Count people per department","answer":{"steps":[
  {"graph":{"patterns":[{"objects":[{"class":"person","variable":"p","idx":0},{"class":"department","variable":"d","idx":1}],
    "relationship":[{"from":0,"to":1,"type":["belongs_to"],"min_hops":1,"max_hops":1}]}]},
   "output":{"to_user":false,"save_table":"/temp01","fields":[{"variable":"p","field":"id","as":"person_id"},
    {"variable":"d","field":"id","as":"department_id"}]}},
  {"graph":{"patterns":[{"objects":[{"class":"/temp01","variable":"t","idx":0}]}]},
   "output":{"to_user":true,"fields":[{"variable":"t","field":"department_id","as":"department_id"},
    {"variable":"t","field":"person_id","function":"count","as":"person_count"}],
    "group_by":{"fields":[{"variable":"t","field":"department_id"}]}}}
]}}
```
