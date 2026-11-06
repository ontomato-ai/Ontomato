		6.3.4 The output of a vector type field requires at least two steps; in the query step the field is output to a temporary table (the as, variable and field attributes are required), and in the following step it is output from the temporary table (consisting of the as, variable, field, query and topK attributes)
   
			6.3.4.1 If in the following step the field has only the as, variable and field attributes, it means outputting all the files corresponding to the vectors of the field
   
			6.3.4.2 If in the following step the field has the as, variable, field and query attributes, it means outputting the files corresponding to the vectors of the field filtered by the text content in query; topK (optional, an integer from 1 to 50, default 20) is how many of the resources most similar to query are kept, and unless the step defines sort, the rows and the files of each row are listed from the most similar
			
		- It is not allowed to perform group by and having operations on vector type fields in output
		- It is not allowed to perform sort operations on vector type fields in output
